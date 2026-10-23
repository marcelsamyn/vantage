/**
 * Reader for miniSEED 2.x, the format seismic networks serve: fixed-size records with a header, a blockette 1000 that names the
 * encoding, and compressed samples. It handles the encodings used by the networks VANTAGE reads (16/32-bit integers, 32/64-bit
 * floats, Steim-1 and Steim-2) in either byte order.
 */

export interface Trace {
  /** Time of the first sample, epoch milliseconds. */
  startMs: number;
  sampleRate: number;
  /** Raw counts. Samples missing because of gaps in the data are NaN. */
  samples: Float64Array;
}

interface RecordHeader {
  net: string;
  sta: string;
  loc: string;
  cha: string;
  startMs: number;
  sampleRate: number;
  sampleCount: number;
  dataOffset: number;
  encoding: number;
  littleEndian: boolean;
  recordLength: number;
}

const ASCII = new TextDecoder("ascii");

/** The "BTIME" fields of a header: year, day of year, time of day and 0.1 ms ticks. */
function startTime(dv: DataView, little: boolean): number {
  const year = dv.getUint16(20, little);
  const dayOfYear = dv.getUint16(22, little);
  const ms = dv.getUint8(24) * 3_600_000 + dv.getUint8(25) * 60_000 + dv.getUint8(26) * 1000 + dv.getUint16(28, little) / 10;
  return Date.UTC(year, 0, 1) + (dayOfYear - 1) * 86_400_000 + ms;
}

function sampleRateOf(factor: number, multiplier: number): number {
  if (factor === 0) return 0;
  const f = factor > 0 ? factor : -1 / factor;
  const m = multiplier > 0 ? multiplier : multiplier < 0 ? -1 / multiplier : 1;
  return f * m;
}

function readHeader(bytes: Uint8Array, at: number): RecordHeader | null {
  if (at + 48 > bytes.length) return null;
  const dv = new DataView(bytes.buffer, bytes.byteOffset + at);
  const year = dv.getUint16(20, false);
  const little = !(year >= 1900 && year <= 2200);
  const blocketteOffset = dv.getUint16(46, little);
  // Find blockette 1000, which holds the encoding and record length.
  let encoding = -1;
  let wordOrderLittle = little;
  let recordExp = 0;
  let next = blocketteOffset;
  for (let i = 0; i < dv.getUint8(39) && next > 0 && at + next + 8 <= bytes.length; i++) {
    const type = dv.getUint16(next, little);
    if (type === 1000) {
      encoding = dv.getUint8(next + 4);
      wordOrderLittle = dv.getUint8(next + 5) === 0;
      recordExp = dv.getUint8(next + 6);
      break;
    }
    next = dv.getUint16(next + 2, little);
  }
  if (encoding < 0 || recordExp < 8 || recordExp > 16) return null;
  const text = (from: number, len: number): string => ASCII.decode(bytes.subarray(at + from, at + from + len)).trim();
  return {
    net: text(18, 2),
    sta: text(8, 5),
    loc: text(13, 2),
    cha: text(15, 3),
    startMs: startTime(dv, little),
    sampleRate: sampleRateOf(dv.getInt16(32, little), dv.getInt16(34, little)),
    sampleCount: dv.getUint16(30, little),
    dataOffset: dv.getUint16(44, little),
    encoding,
    littleEndian: wordOrderLittle,
    recordLength: 2 ** recordExp,
  };
}

/** Sign-extend the low `bits` bits of `value`. */
const signed = (value: number, bits: number): number => (value << (32 - bits)) >> (32 - bits);

/** Steim-1 and Steim-2: frames of sixteen 32-bit words, the first of which holds two-bit codes for the other fifteen. */
function steim(dv: DataView, start: number, end: number, count: number, steim2: boolean): number[] {
  const diffs: number[] = [];
  let x0 = 0;
  for (let frame = start; frame + 64 <= end && diffs.length < count + 1; frame += 64) {
    const control = dv.getUint32(frame, false);
    for (let w = 1; w < 16; w++) {
      const word = dv.getUint32(frame + w * 4, false);
      const code = (control >>> (30 - 2 * w)) & 3;
      if (frame === start && w === 1) {
        x0 = signed(word, 32);
        continue;
      }
      if (frame === start && w === 2) continue; // reverse integration constant
      if (code === 0) continue;
      if (!steim2) {
        if (code === 1) for (let b = 0; b < 4; b++) diffs.push(signed((word >>> (24 - 8 * b)) & 0xff, 8));
        else if (code === 2) for (let b = 0; b < 2; b++) diffs.push(signed((word >>> (16 - 16 * b)) & 0xffff, 16));
        else diffs.push(signed(word, 32));
        continue;
      }
      if (code === 1) {
        for (let b = 0; b < 4; b++) diffs.push(signed((word >>> (24 - 8 * b)) & 0xff, 8));
        continue;
      }
      const dnib = word >>> 30;
      const bits = code === 2 ? [0, 30, 15, 10][dnib] : [6, 5, 4][dnib];
      const n = code === 2 ? [0, 1, 2, 3][dnib] : [5, 6, 7][dnib];
      if (!bits || !n) continue;
      for (let k = 0; k < n; k++) diffs.push(signed((word >>> (bits * (n - 1 - k))) & (2 ** bits - 1), bits));
    }
  }
  // The first difference links this record to the previous one; the first sample is the integration constant.
  const out: number[] = [x0];
  for (let i = 1; i < Math.min(count, diffs.length); i++) out.push((out[i - 1] ?? 0) + (diffs[i] ?? 0));
  return out.slice(0, count);
}

function samplesOf(bytes: Uint8Array, at: number, h: RecordHeader): number[] {
  const dv = new DataView(bytes.buffer, bytes.byteOffset + at);
  const end = h.recordLength;
  const little = h.littleEndian;
  switch (h.encoding) {
    case 1:
      return Array.from({ length: h.sampleCount }, (_, i) => dv.getInt16(h.dataOffset + i * 2, little));
    case 3:
      return Array.from({ length: h.sampleCount }, (_, i) => dv.getInt32(h.dataOffset + i * 4, little));
    case 4:
      return Array.from({ length: h.sampleCount }, (_, i) => dv.getFloat32(h.dataOffset + i * 4, little));
    case 5:
      return Array.from({ length: h.sampleCount }, (_, i) => dv.getFloat64(h.dataOffset + i * 8, little));
    case 10:
    case 11:
      return steim(dv, h.dataOffset, end, h.sampleCount, h.encoding === 11);
    default:
      throw new Error(`miniSEED encoding ${h.encoding} is not supported`);
  }
}

/**
 * Join every record of a miniSEED download into one trace. Records must come from a single channel; the first record sets
 * the sample rate. Returns null when the download holds no readable record.
 */
export function readMiniSeed(bytes: Uint8Array): Trace | null {
  const records: { h: RecordHeader; samples: number[] }[] = [];
  let at = 0;
  while (at < bytes.length) {
    const h = readHeader(bytes, at);
    if (!h) break;
    if (at + h.recordLength > bytes.length) break;
    if (h.sampleRate > 0 && h.sampleCount > 0) records.push({ h, samples: samplesOf(bytes, at, h) });
    at += h.recordLength;
  }
  const first = records[0];
  const last = records[records.length - 1];
  if (!first || !last) return null;
  const rate = first.h.sampleRate;
  const startMs = first.h.startMs;
  const length = Math.round(((last.h.startMs - startMs) / 1000) * rate) + last.samples.length;
  const samples = new Float64Array(length).fill(Number.NaN);
  for (const r of records) {
    const offset = Math.round(((r.h.startMs - startMs) / 1000) * rate);
    for (let i = 0; i < r.samples.length; i++) if (offset + i >= 0 && offset + i < length) samples[offset + i] = r.samples[i] ?? Number.NaN;
  }
  return { startMs, sampleRate: rate, samples };
}
