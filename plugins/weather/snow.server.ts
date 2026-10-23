import { diskMemo, fetchJson, HttpError, memo, z } from "../../server/kit";
import type { SnowHistory, SnowPoint, SnowStation, SnowStations } from "./types";

/**
 * IMIS, the snow-measuring network of the WSL Institute for Snow and Avalanche Research SLF (CC BY 4.0):
 * about 200 automatic stations in the Swiss Alps, each reporting every 30 minutes. Documented at https://measurement-api.slf.ch/.
 */

const API = "https://measurement-api.slf.ch/public/api/imis";

/** A rise in snow depth this big within six hours is snowfall, not sensor noise (a reading wanders by about a centimetre). */
export const FRESH_RISE_CM = 5;
const WINDOW_MS = 6 * 3_600_000;
const MIN_READINGS = 6;

// ── Pure derivation (tested) ──────────────────────────────────────

export interface Reading {
  /** Unix milliseconds. */
  t: number;
  /** Snow depth in centimetres, or null when the sensor sent nothing. */
  hs: number | null;
}

const median3 = (a: number, b: number, c: number): number => a + b + c - Math.min(a, b, c) - Math.max(a, b, c);

/** Depth smoothed with a three-reading median, so a bird on the sensor or a single bad reading cannot look like snowfall. */
function smoothed(readings: readonly Reading[]): { t: number; hs: number }[] {
  const valid = [...readings].filter((r): r is { t: number; hs: number } => r.hs !== null).sort((a, b) => a.t - b.t);
  return valid.map((r, i) => ({ t: r.t, hs: i >= 2 ? median3(valid[i - 2]!.hs, valid[i - 1]!.hs, r.hs) : r.hs }));
}

export interface DepthChange {
  depthCm: number;
  riseCm: number;
  fresh: boolean;
  /** Unix milliseconds of the latest reading. */
  at: number;
}

/** Current depth and how far it rose over the last six hours; null when the sensor has no usable readings. */
export function depthChange(readings: readonly Reading[]): DepthChange | null {
  const series = smoothed(readings);
  const last = series.at(-1);
  if (!last) return null;
  const window = series.filter((r) => r.t > last.t - WINDOW_MS);
  const rise = window.length >= MIN_READINGS ? Math.max(0, last.hs - Math.min(...window.map((r) => r.hs))) : 0;
  const riseCm = Math.round(rise * 10) / 10;
  return { depthCm: Math.round(last.hs * 10) / 10, riseCm, fresh: riseCm >= FRESH_RISE_CM, at: last.t };
}

// ── Upstream ───────────────────────────────────────────────────

const Num = z.number().nullish();
const Station = z.object({
  code: z.string(),
  label: z.string(),
  lat: z.number(),
  lon: z.number(),
  elevation: z.number(),
  country_code: z.enum(["CH", "LI"]),
  canton_code: z.string().nullish(),
});
const Measurement = z.object({
  station_code: z.string(),
  measure_date: z.string(),
  HS: Num,
  TA_30MIN_MEAN: Num,
  TSS_30MIN_MEAN: Num,
  TS25_30MIN_MEAN: Num,
  TS50_30MIN_MEAN: Num,
  TS100_30MIN_MEAN: Num,
});
type Measure = z.infer<typeof Measurement>;

const stationList = (): Promise<z.infer<typeof Station>[]> => diskMemo("slf-imis-stations", 24 * 3_600_000, () => fetchJson("SLF IMIS stations", `${API}/stations`, z.array(Station)), z.array(Station));

const lastDay = (): Promise<Measure[]> => memo("slf:imis:24h", 10 * 60_000, () => fetchJson("SLF IMIS measurements", `${API}/measurements`, z.array(Measurement), { timeoutMs: 30_000 }));

const readingOf = (m: Measure): Reading => ({ t: Date.parse(m.measure_date), hs: m.HS ?? null });

export async function snowStations(): Promise<SnowStations> {
  const [stations, rows] = await Promise.all([stationList(), lastDay()]);
  const byStation = new Map<string, Measure[]>();
  for (const m of rows) byStation.set(m.station_code, [...(byStation.get(m.station_code) ?? []), m]);
  const out: SnowStation[] = [];
  for (const s of stations) {
    const measures = byStation.get(s.code) ?? [];
    const change = depthChange(measures.map(readingOf));
    // Wind-only stations never report a depth; they are part of the network but not of this layer.
    if (!change) continue;
    const latest = measures.filter((m) => Date.parse(m.measure_date) === change.at).at(-1);
    out.push({
      code: s.code,
      name: s.label,
      lat: s.lat,
      lon: s.lon,
      elevationM: s.elevation,
      canton: s.canton_code ?? null,
      country: s.country_code,
      depthCm: change.depthCm,
      riseCm: change.riseCm,
      fresh: change.fresh,
      airC: latest?.TA_30MIN_MEAN ?? null,
      at: new Date(change.at).toISOString().replace(".000Z", "Z"),
    });
  }
  return { fetchedAt: Date.now(), networkSize: stations.length, stations: out };
}

export async function snowHistory(code: string): Promise<SnowHistory> {
  const all = await snowStations();
  const station = all.stations.find((s) => s.code === code);
  if (!station) throw new HttpError(404, "no_such_station", `No snow station called ${code}; it may measure only wind`);
  const rows = await memo(`slf:imis:7d:${code}`, 10 * 60_000, () => fetchJson("SLF IMIS measurements", `${API}/station/${encodeURIComponent(code)}/measurements?period_in_days=7`, z.array(Measurement), { timeoutMs: 20_000 }));
  const sorted = [...rows].sort((a, b) => a.measure_date.localeCompare(b.measure_date));
  const series: SnowPoint[] = sorted.map((m) => ({ t: Date.parse(m.measure_date) / 1000, depthCm: m.HS ?? null, airC: m.TA_30MIN_MEAN ?? null }));
  const last = sorted.at(-1);
  return {
    station,
    snowpack: { surfaceC: last?.TSS_30MIN_MEAN ?? null, at25cmC: last?.TS25_30MIN_MEAN ?? null, at50cmC: last?.TS50_30MIN_MEAN ?? null, at100cmC: last?.TS100_30MIN_MEAN ?? null },
    series,
  };
}
