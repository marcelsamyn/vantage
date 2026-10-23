import { HttpError, fetchJson, log, memo, z } from "../../server/kit";
import { distanceM } from "../../shared/geo";
import { analyse, toReading, type Analysed, type Sample } from "./analysis";
import type { Gauge, GaugeAlerts, GaugeReading } from "./types";

/**
 * Tide gauges from the IOC Sea Level Station Monitoring facility (VLIZ and UNESCO/IOC). The browser names a station code;
 * the server finds it in the facility's own station list, so no URL ever comes from the browser.
 */

const BASE = "https://www.ioc-sealevelmonitoring.org/service.php";
/** The list is 1.3 MB; the facility refreshes readings every few minutes. */
const LIST_TTL_MS = 3 * 60_000;
const SERIES_TTL_MS = 60_000;
/** A gauge that has not reported for this long is offline for our purposes. */
const ALIVE_MS = 6 * 3_600_000;
const DAY_MS = 24 * 3_600_000;
const CONCURRENCY = 4;
/** Pressure and battery sensors share the station list with the water-level ones. */
const NOT_SEA_LEVEL = new Set(["atm", "bat"]);

const StationRow = z.object({
  Code: z.string(),
  Location: z.string().nullish(),
  countryname: z.string().nullish(),
  lat: z.number().nullish(),
  lon: z.number().nullish(),
  sensor: z.string().nullish(),
  units: z.string().nullish(),
  /** Minutes between readings; fractions mean seconds. */
  rate: z.number().nullish(),
  lasttime: z.string().nullish(),
  lastvalue: z.number().nullish(),
});
const StationList = z.array(StationRow);

const Reading = z.object({ slevel: z.number().nullable(), stime: z.string(), sensor: z.string() });
const Readings = z.array(Reading);

export interface Station extends Omit<Gauge, "level"> {
  sensor: string;
}

/** The facility sends UTC without a zone: "2026-10-09 00:29:30.000". */
const utc = (text: string): number => Date.parse(`${text.trim().replace(" ", "T")}Z`);

const NO_DATA = [-1, -999];

/** Gauges that report sea level in metres and have spoken recently. */
export function liveStations(rows: z.infer<typeof StationList>, now: number): Station[] {
  return rows.flatMap((r): Station[] => {
    const at = r.lasttime ? utc(r.lasttime) : Number.NaN;
    const valueM = r.lastvalue;
    if (r.units !== "M" || !r.sensor || NOT_SEA_LEVEL.has(r.sensor)) return [];
    if (r.lat == null || r.lon == null || !Number.isFinite(at) || now - at > ALIVE_MS) return [];
    if (valueM == null || NO_DATA.includes(valueM) || Math.abs(valueM) > 25) return [];
    return [{ code: r.Code, name: (r.Location ?? r.Code).trim(), country: r.countryname ?? "", lat: r.lat, lon: r.lon, sensor: r.sensor, intervalMin: Math.max(r.rate ?? 1, 1 / 60), valueM, at }];
  });
}

async function stations(): Promise<Station[]> {
  const rows = await memo("sea:stations", LIST_TTL_MS, () => fetchJson("Sea level stations · IOC", `${BASE}?query=stationlist&showall=a&output=json`, StationList, { timeoutMs: 30_000 }));
  return liveStations(rows, Date.now());
}

export async function findStation(code: string): Promise<Station> {
  const station = (await stations()).find((s) => s.code === code);
  if (!station) throw new HttpError(404, "unknown_gauge", `No live gauge has the code ${code}. It may be offline: the facility lists only gauges that reported in the last six hours.`);
  return station;
}

const asGauge = (s: Station, level: Gauge["level"]): Gauge => ({ code: s.code, name: s.name, country: s.country, lat: s.lat, lon: s.lon, intervalMin: s.intervalMin, valueM: s.valueM, at: s.at, level });

/** Station list inside a box (west may exceed east across the date line), nearest to the box centre first. */
export async function gaugesIn(box: { west: number; south: number; east: number; north: number }, limit: number): Promise<Station[]> {
  const centre = { lat: (box.south + box.north) / 2, lon: box.west <= box.east ? (box.west + box.east) / 2 : (((box.west + box.east + 360) / 2 + 180) % 360) - 180 };
  const inside = (s: Station): boolean => s.lat >= box.south && s.lat <= box.north && (box.west <= box.east ? s.lon >= box.west && s.lon <= box.east : s.lon >= box.west || s.lon <= box.east);
  return (await stations())
    .filter(inside)
    .sort((a, b) => distanceM(centre, a) - distanceM(centre, b))
    .slice(0, limit);
}

export async function gaugesNear(at: { lat: number; lon: number }, radiusKm: number, limit: number): Promise<Station[]> {
  return (await stations())
    .map((s) => ({ s, d: distanceM(at, s) }))
    .filter((x) => x.d <= radiusKm * 1000)
    .sort((a, b) => a.d - b.d)
    .slice(0, limit)
    .map((x) => x.s);
}

const stamp = (ms: number): string => new Date(ms).toISOString().slice(0, 19);

/** The last 24 hours of one gauge's own sensor. A station can send several sensors in one reply (two pressure gauges with different zeros). */
async function samples(station: Station): Promise<Sample[]> {
  return memo(`sea:series:${station.code}`, SERIES_TTL_MS, async () => {
    const now = Date.now();
    const url = `${BASE}?query=data&code=${encodeURIComponent(station.code)}&timestart=${stamp(now - DAY_MS)}&timestop=${stamp(now + 600_000)}&format=json`;
    const rows = await fetchJson(`Sea level · ${station.name}`, url, Readings, { timeoutMs: 25_000 });
    const mine = rows.filter((r) => r.sensor === station.sensor);
    return mine.flatMap((r): Sample[] => (r.slevel === null ? [] : [{ t: utc(r.stime), v: r.slevel }]));
  });
}

async function analysed(station: Station): Promise<Analysed> {
  const result = analyse(await samples(station));
  if (!result) throw new HttpError(404, "no_data", `${station.name} sent too few readings in the last 24 hours to judge its sea level.`);
  return result;
}

/** Run `fn` over `items`, at most `CONCURRENCY` at a time, so one map view does not open dozens of connections to a volunteer-run service. */
async function pooled<T, R>(items: readonly T[], fn: (item: T) => Promise<R>): Promise<PromiseSettledResult<R>[]> {
  const out: PromiseSettledResult<R>[] = Array.from({ length: items.length });
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const i = next++;
      const item = items[i] as T;
      out[i] = await fn(item).then(
        (value): PromiseFulfilledResult<R> => ({ status: "fulfilled", value }),
        (reason: unknown): PromiseRejectedResult => ({ status: "rejected", reason }),
      );
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, worker));
  return out;
}

/** Gauges with their current level, judged from the last 24 hours. A gauge that cannot be judged keeps `level: null`. */
export async function withLevels(list: readonly Station[]): Promise<Gauge[]> {
  const results = await pooled(list, analysed);
  return list.map((s, i) => {
    const r = results[i];
    if (r?.status === "rejected") log.info("sea level not analysed", { gauge: s.code, error: r.reason instanceof Error ? r.reason.message : String(r.reason) });
    return asGauge(s, r?.status === "fulfilled" ? r.value.analysis.recent.level : null);
  });
}

export const plainGauges = (list: readonly Station[]): Gauge[] => list.map((s) => asGauge(s, null));

export async function readingOf(code: string): Promise<GaugeReading> {
  const station = await findStation(code);
  const result = await analysed(station);
  const end = result.series[result.series.length - 1]?.t ?? Date.now();
  return toReading(asGauge(station, result.analysis.recent.level), result, end);
}

/** Gauges near a place whose last 90 minutes were not normal. */
export async function alertsNear(at: { lat: number; lon: number }, radiusKm: number): Promise<GaugeAlerts> {
  const near = await gaugesNear(at, radiusKm, 30);
  const results = await pooled(near, analysed);
  const alerts: GaugeAlerts["alerts"] = [];
  let checked = 0;
  results.forEach((r, i) => {
    const station = near[i];
    if (!station) return;
    if (r.status === "rejected") {
      log.info("sea level not analysed", { gauge: station.code, error: r.reason instanceof Error ? r.reason.message : String(r.reason) });
      return;
    }
    checked++;
    if (r.value.analysis.recent.level !== "normal") alerts.push({ gauge: asGauge(station, r.value.analysis.recent.level), analysis: r.value.analysis });
  });
  return { checked, alerts };
}
