import { diskMemo, parseUpstream, z } from "../../server/kit";
import { distanceM, type LatLon } from "../../shared/geo";
import { distanceToPathM, inRome } from "./area.server";
import { downloadRomeFile, isoDate, newestResource } from "./ckan.server";
import type { Parking, ParkingMeter, ParkingSegment } from "./types";

/** Rome's pay-parking: every blue-line street segment with its tariff and hours, and every parking meter. */

const DAY_MS = 24 * 3_600_000;
/** A blue-line street segment is a polyline along the kerb; a spot within this distance counts as on it. */
const ON_SEGMENT_M = 20;
/** Rome's historic centre is mostly a restricted zone, so the nearest meter there can be a few hundred metres away. */
const METER_RADIUS_M = 500;

const text = z.string().nullish();
const Segments = z.object({
  features: z.array(
    z.object({
      attributes: z.object({ TOPONIMO: text, ZONA: text, AMBITO: text, GIORNI: text, DALLE: text, ALLE: text, TARIFFA: text }),
      geometry: z.object({ paths: z.array(z.array(z.tuple([z.number(), z.number()]))) }).nullish(),
    }),
  ),
});
const Meters = z.object({
  features: z.array(
    z.object({
      attributes: z.object({ INDIRIZZO: text, UBICAZIONE: text, PAGAMENTI: text, TARIFFA: text }),
      geometry: z.object({ x: z.number(), y: z.number() }).nullish(),
    }),
  ),
});

const StoredRegister = z.object({
  asOf: z.string(),
  segments: z.array(
    z.object({
      street: z.string(),
      area: z.string(),
      zone: z.string(),
      days: z.string(),
      from: z.string(),
      to: z.string(),
      tariff: z.string(),
      paths: z.array(z.array(z.tuple([z.number(), z.number()]))),
    }),
  ),
  meters: z.array(z.object({ address: z.string(), detail: z.string().nullable(), payments: z.string(), tariff: z.string(), lat: z.number(), lon: z.number() })),
});

interface SegmentData extends Omit<ParkingSegment, "distanceM"> {
  paths: [number, number][][];
}
interface MeterData extends Omit<ParkingMeter, "distanceM"> {
  lat: number;
  lon: number;
}
interface Register {
  asOf: string;
  segments: SegmentData[];
  meters: MeterData[];
}

const clean = (s: string | null | undefined): string => (s ?? "").replace(/\s+/g, " ").trim();

/** Both files are Esri JSON in WGS84. They are published a few times a year, so the register is cached for a day. */
function register(): Promise<Register> {
  return diskMemo("dossier-rome-parking", DAY_MS, async () => {
    const [blue, meters] = await Promise.all([
      newestResource("atac-003", (r) => r.format === "JSON"),
      newestResource("atac-004", (r) => r.format === "JSON"),
    ]);
    const [blueFile, meterFile] = await Promise.all([downloadRomeFile(blue), downloadRomeFile(meters)]);
    const decode = (bytes: ArrayBuffer): unknown => JSON.parse(new TextDecoder("utf-8").decode(bytes));

    const segments = parseUpstream("Roma Capitale · Strisce blu", Segments, decode(blueFile)).features.flatMap((f): SegmentData[] => {
      if (!f.geometry) return [];
      const a = f.attributes;
      return [{ street: clean(a.TOPONIMO), area: clean(a.AMBITO), zone: clean(a.ZONA), days: clean(a.GIORNI), from: clean(a.DALLE), to: clean(a.ALLE), tariff: clean(a.TARIFFA), paths: f.geometry.paths }];
    });
    const points = parseUpstream("Roma Capitale · Parcometri", Meters, decode(meterFile)).features.flatMap((f): MeterData[] => {
      if (!f.geometry) return [];
      const a = f.attributes;
      return [{ address: clean(a.INDIRIZZO), detail: clean(a.UBICAZIONE) || null, payments: clean(a.PAGAMENTI), tariff: clean(a.TARIFFA), lat: f.geometry.y, lon: f.geometry.x }];
    });
    return { asOf: isoDate(blue.stamp ?? ""), segments, meters: points } satisfies Register;
  }, StoredRegister);
}

/** The blue-line segment under the point and the nearest meters, or null outside Rome. */
export async function parkingAt(at: LatLon): Promise<Parking | null> {
  if (!inRome(at)) return null;
  const data = await register();

  let segment: ParkingSegment | null = null;
  for (const s of data.segments) {
    const d = Math.min(...s.paths.map((path) => distanceToPathM(at, path)));
    if (d <= ON_SEGMENT_M && (!segment || d < segment.distanceM)) {
      const { paths: _paths, ...rest } = s;
      segment = { ...rest, distanceM: Math.round(d) };
    }
  }

  const meters = data.meters
    .map((m) => ({ m, d: distanceM(at, m) }))
    .filter(({ d }) => d <= METER_RADIUS_M)
    .sort((a, b) => a.d - b.d)
    .slice(0, 3)
    .map(({ m, d }): ParkingMeter => ({ address: m.address, detail: m.detail, payments: m.payments, tariff: m.tariff, distanceM: Math.round(d) }));

  return { segment, meters, asOf: data.asOf };
}
