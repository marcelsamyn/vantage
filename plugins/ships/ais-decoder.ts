/**
 * Decoder for AIS messages carried in NMEA 0183 `!AIVDM` / `!AIVDO` sentences (ITU-R M.1371).
 * It reads position reports (types 1, 2, 3, 18, 19) and static data (types 5, 19, 24). Other message types are ignored.
 */

/** A vessel's reported position and motion. Fields the vessel marks "not available" are null. */
export interface AisPosition {
  kind: "position";
  mmsi: number;
  lat: number;
  lon: number;
  sogKt: number | null;
  cogDeg: number | null;
  headingDeg: number | null;
  /** Navigation status 0–14 (class A only). */
  navStatus: number | null;
}

/** What a vessel says about itself. A message carries some of these fields; absent ones are undefined. */
export interface AisStatic {
  kind: "static";
  mmsi: number;
  imo?: number;
  callSign?: string;
  name?: string;
  shipType?: number;
  toBowM?: number;
  toSternM?: number;
  toPortM?: number;
  toStarboardM?: number;
  /** Maximum static draught in metres. */
  draughtM?: number;
  destination?: string;
  /** Estimated arrival as [month, day, hour, minute] in UTC; null when the vessel did not set it. */
  eta?: [number, number, number, number] | null;
}

export type AisMessage = AisPosition | AisStatic;

class Bits {
  constructor(
    private readonly bits: Uint8Array,
    readonly length: number,
  ) {}

  uint(start: number, len: number): number {
    let v = 0;
    for (let i = start; i < start + len; i++) v = v * 2 + (this.bits[i] ?? 0);
    return v;
  }

  int(start: number, len: number): number {
    const v = this.uint(start, len);
    return v >= 2 ** (len - 1) ? v - 2 ** len : v;
  }

  /** Six-bit ASCII text. Padding ("@") and trailing spaces are removed. */
  text(start: number, len: number): string {
    let out = "";
    for (let i = start; i + 6 <= start + len; i += 6) {
      const c = this.uint(i, 6);
      out += String.fromCharCode(c < 32 ? c + 64 : c);
    }
    return out.replace(/[@ ]+$/, "");
  }
}

/** Turn the armoured payload of a sentence into bits, dropping the fill bits the sender added to reach a 6-bit boundary. */
function unarmour(payload: string, fillBits: number): Bits {
  const bits = new Uint8Array(payload.length * 6);
  for (let i = 0; i < payload.length; i++) {
    let v = payload.charCodeAt(i) - 48;
    if (v > 40) v -= 8;
    for (let b = 0; b < 6; b++) bits[i * 6 + b] = (v >> (5 - b)) & 1;
  }
  return new Bits(bits, Math.max(0, bits.length - fillBits));
}

function checksumOk(body: string, given: string): boolean {
  let x = 0;
  for (let i = 0; i < body.length; i++) x ^= body.charCodeAt(i);
  return x === Number.parseInt(given, 16);
}

const SENTENCE = /^!([A-Z]{2}VD[MO]),(\d+),(\d+),([^,]*),([^,]*),([^,*]*),(\d)\*([0-9A-Fa-f]{2})/;

/** Keeps the fragments of multi-sentence messages until the last one arrives. */
export class AisDecoder {
  private readonly pending = new Map<string, { count: number; parts: Map<number, string> }>();

  /**
   * Feed one line from the stream. Returns the decoded messages: none for a fragment, a damaged line or a type that is not
   * decoded, and two for an extended class B report (type 19), which carries both a position and static data.
   */
  push(line: string): AisMessage[] {
    // Tag blocks (`\s:station,c:time*hh\`) can precede the sentence; the sentence itself starts at "!".
    const start = line.indexOf("!");
    if (start < 0) return [];
    const m = SENTENCE.exec(line.slice(start).trim());
    if (!m) return [];
    const [whole, , countText, numberText, seqId, channel, payload, fillText, checksum] = m;
    if (!whole || !countText || !numberText || payload === undefined || !checksum) return [];
    if (!checksumOk(whole.slice(1, whole.indexOf("*")), checksum)) return [];

    const count = Number(countText);
    const number = Number(numberText);
    const fill = Number(fillText);
    if (count === 1) return decodeMessage(unarmour(payload, fill));

    // Fragments of different messages interleave; the sequence id and channel tell them apart.
    const key = `${seqId ?? ""}/${channel ?? ""}`;
    let entry = this.pending.get(key);
    if (!entry || entry.count !== count || number === 1) {
      entry = { count, parts: new Map() };
      this.pending.set(key, entry);
    }
    entry.parts.set(number, payload);
    if (entry.parts.size < count) return [];
    this.pending.delete(key);
    let joined = "";
    for (let i = 1; i <= count; i++) {
      const part = entry.parts.get(i);
      if (part === undefined) return [];
      joined += part;
    }
    // The fill bits sit at the end of the last fragment.
    return decodeMessage(unarmour(joined, fill));
  }
}

const listOf = (m: AisMessage | null): AisMessage[] => (m ? [m] : []);

function decodeMessage(b: Bits): AisMessage[] {
  if (b.length < 38) return [];
  const type = b.uint(0, 6);
  const mmsi = b.uint(8, 30);
  switch (type) {
    case 1:
    case 2:
    case 3:
      return b.length < 137 ? [] : listOf(position(mmsi, b.uint(50, 10), b.int(61, 28), b.int(89, 27), b.uint(116, 12), b.uint(128, 9), b.uint(38, 4)));
    case 18:
      return b.length < 133 ? [] : listOf(position(mmsi, b.uint(46, 10), b.int(57, 28), b.int(85, 27), b.uint(112, 12), b.uint(124, 9), null));
    case 19:
      if (b.length < 312) return [];
      return [
        ...listOf(position(mmsi, b.uint(46, 10), b.int(57, 28), b.int(85, 27), b.uint(112, 12), b.uint(124, 9), null)),
        { kind: "static", mmsi, name: b.text(143, 120) || undefined, shipType: b.uint(263, 8) || undefined, ...dimensions(b, 271) },
      ];
    case 5:
      if (b.length < 424) return [];
      return [
        {
          kind: "static",
          mmsi,
          imo: b.uint(40, 30) || undefined,
          callSign: b.text(70, 42) || undefined,
          name: b.text(112, 120) || undefined,
          shipType: b.uint(232, 8) || undefined,
          ...dimensions(b, 240),
          eta: eta(b.uint(274, 4), b.uint(278, 5), b.uint(283, 5), b.uint(288, 6)),
          draughtM: b.uint(294, 8) / 10 || undefined,
          destination: b.text(302, 120) || undefined,
        },
      ];
    case 24: {
      const part = b.uint(38, 2);
      if (part === 0) return b.length < 160 ? [] : [{ kind: "static", mmsi, name: b.text(40, 120) || undefined }];
      if (part !== 1 || b.length < 162) return [];
      // Auxiliary craft (MMSI 98xxxxxxx) put their mother ship's MMSI where the dimensions would be.
      const auxiliary = String(mmsi).startsWith("98");
      return [{ kind: "static", mmsi, shipType: b.uint(40, 8) || undefined, callSign: b.text(90, 42) || undefined, ...(auxiliary ? {} : dimensions(b, 132)) }];
    }
    default:
      return [];
  }
}

function position(mmsi: number, sog: number, lon: number, lat: number, cog: number, heading: number, navStatus: number | null): AisPosition | null {
  // Longitude 181° and latitude 91° mean "no position fix".
  if (Math.abs(lon) > 108_000_000 || Math.abs(lat) > 54_000_000) return null;
  return {
    kind: "position",
    mmsi,
    lon: lon / 600_000,
    lat: lat / 600_000,
    sogKt: sog >= 1023 ? null : sog / 10,
    cogDeg: cog >= 3600 ? null : cog / 10,
    headingDeg: heading >= 360 ? null : heading,
    navStatus: navStatus === null || navStatus === 15 ? null : navStatus,
  };
}

function dimensions(b: Bits, at: number): Pick<AisStatic, "toBowM" | "toSternM" | "toPortM" | "toStarboardM"> {
  return { toBowM: b.uint(at, 9), toSternM: b.uint(at + 9, 9), toPortM: b.uint(at + 18, 6), toStarboardM: b.uint(at + 24, 6) };
}

function eta(month: number, day: number, hour: number, minute: number): [number, number, number, number] | null {
  // Month 0, day 0, hour 24 and minute 60 are the "not available" values.
  if (month === 0 || day === 0 || hour > 23 || minute > 59) return null;
  return [month, day, hour, minute];
}
