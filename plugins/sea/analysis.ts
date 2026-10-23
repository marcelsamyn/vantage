import type { GaugeAnalysis, GaugeReading, SeaLevel, Swing, SwingKind } from "./types";

/**
 * Finds sudden steps and oscillations in a tide gauge record. Pure functions; the network calls live in gauges.server.ts.
 *
 * The method: take out spikes, take out the tide (a smooth curve fitted over one hour around every minute), and measure
 * how far what is left swings inside any 30-minute window. A gauge is judged against its own quiet hours, because a
 * harbour that sloshes by 10 cm every day is normal and one that sloshes by 10 cm after years of 1 cm is not.
 * Thresholds were checked against recorded data: 78 gauges for a day, 28 days at Anzio, and the Tonga eruption wave of
 * January 2022 at Catania (see analysis.test.ts).
 */

export interface Sample {
  /** Epoch milliseconds. */
  t: number;
  /** Metres. */
  v: number;
}

const MINUTE = 60_000;
/** Half the width of the window the tide is fitted over. */
const FIT_HALF_MIN = 30;
const RANGE_WINDOW_MIN = 30;
const RECENT_MIN = 90;
/** A reading this far from the median of its four neighbours is a recording glitch: real water does not jump 30 cm for one minute. */
const SPIKE_M = 0.3;
/** Larger than any tide on Earth (the Bay of Fundy reaches about 16 m). Fills such as 80 m are glitches. */
const MAX_ABS_M = 25;
/** Gauges report "no data" as -1 or -999. */
const NO_DATA_M = -1;
/** Below this, readings are not frequent enough to see seiches, which swing in a few minutes. */
const COARSE_MIN = 2;
const MIN_QUIET_M = 0.01;
const MIN_SAMPLES = 40;

export const THRESHOLDS = {
  /** A swing counts as unusual from this many times the gauge's quiet swing, and never below this size. */
  unusual: { times: 6, floorM: 0.2 },
  restless: { times: 3.5, floorM: 0.08 },
  /** Readings several minutes apart on a big tide leave more fitting error, so "restless" asks for more there. */
  coarseRestless: { times: 5, floorM: 0.15 },
} as const;

/** One value per minute (the median of that minute's readings), without invalid readings and spikes. */
export function cleanSeries(samples: readonly Sample[]): Sample[] {
  const byMinute = new Map<number, number[]>();
  for (const s of samples) {
    if (!Number.isFinite(s.v) || !Number.isFinite(s.t) || Math.abs(s.v) > MAX_ABS_M || s.v === NO_DATA_M) continue;
    const minute = Math.floor(s.t / MINUTE) * MINUTE;
    const bucket = byMinute.get(minute);
    if (bucket) bucket.push(s.v);
    else byMinute.set(minute, [s.v]);
  }
  const perMinute = [...byMinute].map(([t, values]): Sample => ({ t, v: median(values) })).sort((a, b) => a.t - b.t);
  return perMinute.filter((s, i) => {
    const neighbours = [perMinute[i - 2], perMinute[i - 1], perMinute[i + 1], perMinute[i + 2]].flatMap((n) => (n ? [n.v] : []));
    return neighbours.length < 3 || Math.abs(s.v - median(neighbours)) <= SPIKE_M;
  });
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? (sorted[mid] ?? 0) : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

/** Typical gap between readings, in minutes. */
export function readingSpacingMin(series: readonly Sample[]): number {
  const gaps = series.slice(1).map((s, i) => (s.t - (series[i]?.t ?? s.t)) / MINUTE);
  return gaps.length ? median(gaps) : 0;
}

/** Mean of the readings within `halfMin` minutes of each reading. Takes the chop off one-minute data. */
function smooth(series: readonly Sample[], halfMin: number): Sample[] {
  const reach = halfMin * MINUTE;
  let from = 0;
  let to = 0;
  return series.map((s) => {
    while ((series[from]?.t ?? 0) < s.t - reach) from++;
    while (to < series.length && (series[to]?.t ?? Infinity) <= s.t + reach) to++;
    let sum = 0;
    for (let j = from; j < to; j++) sum += series[j]?.v ?? 0;
    return { t: s.t, v: sum / (to - from) };
  });
}

/** Value of the quadratic through the points `(x, y)` at `at`, by least squares; null when the fit is degenerate. */
function quadraticAt(xs: readonly number[], ys: readonly number[], at: number): number | null {
  const mean = ys.reduce((a, b) => a + b, 0) / ys.length;
  let s1 = 0;
  let s2 = 0;
  let s3 = 0;
  let s4 = 0;
  let r0 = 0;
  let r1 = 0;
  let r2 = 0;
  for (let i = 0; i < xs.length; i++) {
    const x = xs[i] ?? 0;
    const y = (ys[i] ?? 0) - mean;
    const x2 = x * x;
    s1 += x;
    s2 += x2;
    s3 += x2 * x;
    s4 += x2 * x2;
    r0 += y;
    r1 += x * y;
    r2 += x2 * y;
  }
  const s0 = xs.length;
  const det = (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number): number => a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  const d = det(s0, s1, s2, s1, s2, s3, s2, s3, s4);
  if (Math.abs(d) < 1e-9) return null;
  const a = det(r0, s1, s2, r1, s2, s3, r2, s3, s4) / d;
  const b = det(s0, r0, s2, s1, r1, s3, s2, r2, s4) / d;
  const c = det(s0, s1, r0, s1, s2, r1, s2, s3, r2) / d;
  return mean + a + b * at + c * at * at;
}

/**
 * What is left of each reading once the tide is taken out: the reading minus a quadratic fitted over the hour around it.
 * Near the ends of the record the fit window stops at the last hour of data, so the newest readings are judged against a
 * curve fitted on the hour before them. Null where too few readings surround a point.
 */
export function tideFree(series: readonly Sample[]): (number | null)[] {
  const half = FIT_HALF_MIN * MINUTE;
  const first = series[0]?.t ?? 0;
  const last = series[series.length - 1]?.t ?? 0;
  if (last - first < 2 * half) return series.map(() => null);
  let from = 0;
  let to = 0;
  return series.map((s) => {
    const centre = Math.min(Math.max(s.t, first + half), last - half);
    while ((series[from]?.t ?? 0) < centre - half) from++;
    while (to < series.length && (series[to]?.t ?? Infinity) <= centre + half) to++;
    if (to - from < 6) return null;
    const xs: number[] = [];
    const ys: number[] = [];
    for (let j = from; j < to; j++) {
      xs.push(((series[j]?.t ?? 0) - centre) / half);
      ys.push(series[j]?.v ?? 0);
    }
    const fitted = quadraticAt(xs, ys, (s.t - centre) / half);
    return fitted === null ? null : s.v - fitted;
  });
}

/** For each reading, highest minus lowest of the residuals in the 30 minutes up to it; null with fewer than four. */
function trailingRange(series: readonly Sample[], residual: readonly (number | null)[]): (number | null)[] {
  const window = RANGE_WINDOW_MIN * MINUTE;
  let from = 0;
  return series.map((s, i) => {
    while ((series[from]?.t ?? 0) <= s.t - window) from++;
    let lo = Infinity;
    let hi = -Infinity;
    let n = 0;
    for (let j = from; j <= i; j++) {
      const r = residual[j];
      if (r === null || r === undefined) continue;
      lo = Math.min(lo, r);
      hi = Math.max(hi, r);
      n++;
    }
    return n >= 4 ? hi - lo : null;
  });
}

/** The level a 30-minute swing of `rangeM` earns at a gauge whose quiet swing is `quietM`. */
export function levelOf(rangeM: number, quietM: number, coarse: boolean): SeaLevel {
  if (!coarse && rangeM >= Math.max(THRESHOLDS.unusual.floorM, THRESHOLDS.unusual.times * quietM)) return "unusual";
  const restless = coarse ? THRESHOLDS.coarseRestless : THRESHOLDS.restless;
  if (rangeM >= Math.max(restless.floorM, restless.times * quietM)) return "restless";
  return "normal";
}

/** Whether the residual in the 30 minutes up to `endIndex` goes back and forth or moves one way, how many times it crosses zero, and how long one cycle lasts. */
function describeSwing(series: readonly Sample[], residual: readonly (number | null)[], endIndex: number, rangeM: number): { kind: SwingKind; periodMin: number | null; crossings: number } {
  const endT = series[endIndex]?.t ?? 0;
  const margin = rangeM * 0.15;
  const crossings: number[] = [];
  let side = 0;
  for (let j = endIndex; j >= 0 && (series[j]?.t ?? 0) > endT - RANGE_WINDOW_MIN * MINUTE; j--) {
    const r = residual[j];
    if (r === null || r === undefined) continue;
    const now = r > margin ? 1 : r < -margin ? -1 : 0;
    if (now === 0) continue;
    if (side !== 0 && now !== side) crossings.push(series[j]?.t ?? 0);
    side = now;
  }
  if (crossings.length < 2) return { kind: "step", periodMin: null, crossings: crossings.length };
  const spanMin = ((crossings[0] ?? 0) - (crossings[crossings.length - 1] ?? 0)) / MINUTE;
  return { kind: "oscillation", periodMin: crossings.length >= 3 ? Math.round((2 * spanMin) / (crossings.length - 1)) : null, crossings: crossings.length };
}

export interface Analysed {
  /** The cleaned record, one reading per minute at most. */
  series: Sample[];
  tideFree: (number | null)[];
  analysis: GaugeAnalysis;
}

/** Null when the record is too short or too gappy to judge. */
export function analyse(samples: readonly Sample[]): Analysed | null {
  const cleaned = cleanSeries(samples);
  if (cleaned.length < MIN_SAMPLES) return null;
  const spacing = readingSpacingMin(cleaned);
  const coarse = spacing > COARSE_MIN;
  const series = spacing <= 1.5 ? smooth(cleaned, 2) : cleaned;
  const residual = tideFree(series);
  const range = trailingRange(series, residual);
  const valid = range.flatMap((r) => (r === null ? [] : [r])).sort((a, b) => a - b);
  if (valid.length < MIN_SAMPLES) return null;
  const quietM = Math.max(valid[Math.floor((valid.length - 1) * 0.25)] ?? 0, MIN_QUIET_M);

  const lastT = series[series.length - 1]?.t ?? 0;
  // Every window within 10% of the largest range holds the same swing; the one with the most zero crossings shows its rhythm best.
  const strongest = (fromIndex: number): Swing => {
    let best = 0;
    for (let i = fromIndex; i < range.length; i++) if ((range[i] ?? -1) > (range[best] ?? -1)) best = i;
    const top = range[best] ?? 0;
    let chosen = { index: best, ...describeSwing(series, residual, best, top) };
    for (let i = fromIndex; i < range.length; i++) {
      if ((range[i] ?? 0) < top * 0.9) continue;
      const described = describeSwing(series, residual, i, range[i] ?? top);
      if (described.crossings > chosen.crossings) chosen = { index: i, ...described };
    }
    const rangeM = range[chosen.index] ?? top;
    const end = series[chosen.index]?.t ?? lastT;
    return { level: levelOf(rangeM, quietM, coarse), rangeM, from: end - RANGE_WINDOW_MIN * MINUTE, to: end, kind: chosen.kind, periodMin: chosen.periodMin };
  };
  const recentFrom = series.findIndex((s) => s.t >= lastT - RECENT_MIN * MINUTE);
  return { series, tideFree: residual, analysis: { recent: strongest(Math.max(recentFrom, 0)), day: strongest(0), quietM, coarse } };
}

/** Put a record on a one-minute grid ending at `endMs`, in millimetres, for the chart. */
export function toReading(gauge: GaugeReading["gauge"], analysed: Analysed, endMs: number, spanMs = 24 * 60 * MINUTE): GaugeReading {
  const stepMs = MINUTE;
  const startMs = Math.floor((endMs - spanMs) / stepMs) * stepMs;
  const size = Math.round(spanMs / stepMs) + 1;
  const levelMm: (number | null)[] = Array.from({ length: size }, () => null);
  const tideFreeMm: (number | null)[] = Array.from({ length: size }, () => null);
  analysed.series.forEach((s, i) => {
    const k = Math.round((s.t - startMs) / stepMs);
    if (k < 0 || k >= size) return;
    levelMm[k] = Math.round(s.v * 1000);
    const r = analysed.tideFree[i];
    tideFreeMm[k] = r === null || r === undefined ? null : Math.round(r * 1000);
  });
  return { gauge, startMs, stepMs, levelMm, tideFreeMm, analysis: analysed.analysis };
}

/** The swing level at every minute of a chart grid: the range of the tide-free millimetres over the 30 minutes up to it. */
export function levelsOnGrid(tideFreeMm: readonly (number | null)[], quietM: number, coarse: boolean): SeaLevel[] {
  return tideFreeMm.map((_, k) => {
    let lo = Infinity;
    let hi = -Infinity;
    let n = 0;
    for (let j = Math.max(0, k - RANGE_WINDOW_MIN + 1); j <= k; j++) {
      const v = tideFreeMm[j];
      if (v === null || v === undefined) continue;
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
      n++;
    }
    return n >= 4 ? levelOf((hi - lo) / 1000, quietM, coarse) : "normal";
  });
}
