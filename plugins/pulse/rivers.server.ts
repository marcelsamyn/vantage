import { HttpError, diskMemo, fetchJson, memo, z } from "../../server/kit";
import type { RiverGauge, RiverSeries, RiverSource, RiverStatus, RiverThresholds } from "./types";

/**
 * River levels from three open sources:
 *  - Waterinfo.be (Flanders): 10 to 15 minute levels with the watch and alarm thresholds the Flemish authorities publish.
 *  - Hub'Eau (France): every French gauge, 5 to 10 minute levels, no thresholds in this API (Licence Ouverte 2.0).
 *  - ARPA Lombardia (Lombardy, including Milan): 10 minute levels, no thresholds (CC0).
 * Where a source publishes no thresholds, a gauge's status stays "unknown" instead of guessing.
 */

const HOUR_MS = 3_600_000;
const MAX_GAUGES = 150;
const RECENT_MS = 3 * HOUR_MS;

export interface Bounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

const inside = (b: Bounds, p: { lat: number; lon: number }): boolean => p.lon >= b.west && p.lon <= b.east && p.lat >= b.south && p.lat <= b.north;
const overlaps = (a: Bounds, b: Bounds): boolean => a.west <= b.east && a.east >= b.west && a.south <= b.north && a.north >= b.south;

function statusOf(level: number | null, t: RiverThresholds | null): RiverStatus {
  if (level === null || !t) return "unknown";
  if ((t.alarm !== null && level >= t.alarm) || (t.prealarm !== null && level >= t.prealarm)) return "high";
  if ((t.watch !== null && level >= t.watch) || (t.prewatch !== null && level >= t.prewatch)) return "elevated";
  return t.alarm === null && t.prealarm === null && t.watch === null && t.prewatch === null ? "unknown" : "normal";
}

interface Reading {
  at: number;
  level: number;
}

/** Latest level and the change over the last three hours, from readings in any order. */
function summary(readings: readonly Reading[]): { level: number; at: number; trend3h: number | null } | null {
  const sorted = [...readings].sort((a, b) => a.at - b.at);
  const last = sorted[sorted.length - 1];
  if (!last) return null;
  const first = sorted.find((r) => r.at >= last.at - RECENT_MS);
  return { level: last.level, at: last.at, trend3h: first && first.at < last.at ? last.level - first.level : null };
}

// ── Waterinfo (Flanders) ──────────────────────────────────────────

const KIWIS = "https://download.waterinfo.be/tsmdownload/KiWIS/KiWIS";
const FLANDERS: Bounds = { west: 2.5, south: 50.67, east: 5.95, north: 51.55 };

function kiwis(params: Record<string, string>): URL {
  const url = new URL(KIWIS);
  for (const [k, v] of Object.entries({ service: "kisters", type: "queryServices", datasource: "1", format: "json", ...params })) url.searchParams.set(k, v);
  return url;
}

interface FlemishStation {
  no: string;
  name: string;
  lat: number;
  lon: number;
  level: string;
  thresholds: Partial<Record<keyof RiverThresholds, string>>;
}

const THRESHOLD_SERIES: Record<string, keyof RiverThresholds> = { DrempelPrewaak: "prewatch", DrempelWaak: "watch", DrempelPrealarm: "prealarm", DrempelAlarm: "alarm" };

const StoredFlemishStations = z.array(
  z.object({
    no: z.string(),
    name: z.string(),
    lat: z.number(),
    lon: z.number(),
    level: z.string(),
    thresholds: z.object({ prewatch: z.string().optional(), watch: z.string().optional(), prealarm: z.string().optional(), alarm: z.string().optional() }),
  }),
);

/** Every Flemish level gauge with the ids of its level and threshold series. The list changes rarely. */
function flemishStations(): Promise<FlemishStation[]> {
  return diskMemo("pulse-waterinfo-stations", 24 * HOUR_MS, async () => {
    const rows = await fetchJson(
      "Waterinfo",
      kiwis({ request: "getTimeseriesList", ts_name: ["P.10", "P.15", ...Object.keys(THRESHOLD_SERIES)].join(","), stationparameter_name: "H", returnfields: "ts_id,station_name,station_no,station_latitude,station_longitude,ts_name" }),
      z.array(z.array(z.string())),
      { timeoutMs: 30_000 },
    );
    const stations = new Map<string, FlemishStation & { rank: number }>();
    for (const [tsId, name, no, lat, lon, tsName] of rows.slice(1)) {
      if (!tsId || !name || !no || !tsName) continue;
      const la = Number(lat);
      const lo = Number(lon);
      if (!Number.isFinite(la) || !Number.isFinite(lo)) continue;
      const station = stations.get(no) ?? { no, name, lat: la, lon: lo, level: "", thresholds: {}, rank: 0 };
      const threshold = THRESHOLD_SERIES[tsName];
      if (threshold) station.thresholds[threshold] = tsId;
      // The 10-minute series beats the 15-minute one where a station has both.
      else if (tsName === "P.10" || (tsName === "P.15" && station.rank < 1)) {
        station.level = tsId;
        station.rank = tsName === "P.10" ? 2 : 1;
      }
      stations.set(no, station);
    }
    return [...stations.values()].filter((s) => s.level).map(({ rank: _rank, ...s }) => s);
  }, StoredFlemishStations);
}

const KiwisValues = z.array(z.object({ ts_id: z.string(), data: z.array(z.tuple([z.string(), z.number().nullable()])) }));

async function kiwisValues(ids: readonly string[], period: string): Promise<Map<string, [number, number][]>> {
  const out = new Map<string, [number, number][]>();
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += 80) chunks.push(ids.slice(i, i + 80));
  const results = await Promise.all(chunks.map((chunk) => fetchJson("Waterinfo", kiwis({ request: "getTimeseriesValues", ts_id: chunk.join(","), period, returnfields: "Timestamp,Value" }), KiwisValues, { timeoutMs: 25_000 })));
  for (const series of results.flat()) {
    out.set(
      series.ts_id,
      series.data.flatMap(([t, v]) => (v === null ? [] : [[Date.parse(t), v] as [number, number]])),
    );
  }
  return out;
}

async function flanders(b: Bounds): Promise<RiverGauge[]> {
  if (!overlaps(b, FLANDERS)) return [];
  const stations = (await flemishStations()).filter((s) => inside(b, s)).slice(0, MAX_GAUGES);
  if (stations.length === 0) return [];
  const levelIds = stations.map((s) => s.level);
  const thresholdIds = stations.flatMap((s) => Object.values(s.thresholds));
  const [levels, thresholds] = await Promise.all([
    memo(`pulse:wi:levels:${levelIds.join(",")}`, 5 * 60_000, () => kiwisValues(levelIds, "PT3H")),
    // A threshold is a constant that changes once in a long while; it is kept for hours.
    memo(`pulse:wi:thresholds:${thresholdIds.join(",")}`, 6 * HOUR_MS, () => kiwisValues(thresholdIds, "P3D")),
  ]);
  return stations.map((s): RiverGauge => {
    const readings = (levels.get(s.level) ?? []).map(([at, level]) => ({ at, level }));
    const sum = summary(readings);
    const latestOf = (id: string | undefined): number | null => {
      const series = id ? thresholds.get(id) : undefined;
      return series && series.length > 0 ? (series[series.length - 1]?.[1] ?? null) : null;
    };
    const t: RiverThresholds = { prewatch: latestOf(s.thresholds.prewatch), watch: latestOf(s.thresholds.watch), prealarm: latestOf(s.thresholds.prealarm), alarm: latestOf(s.thresholds.alarm) };
    const known = Object.values(t).some((v) => v !== null);
    return {
      id: `waterinfo:${s.no}`,
      source: "Waterinfo (Flanders)",
      name: s.name,
      river: null,
      lat: s.lat,
      lon: s.lon,
      level: sum?.level ?? null,
      at: sum?.at ?? null,
      thresholds: known ? t : null,
      status: statusOf(sum?.level ?? null, known ? t : null),
      trend3h: sum?.trend3h ?? null,
      url: `https://www.waterinfo.be/default.aspx?path=NL/Thema/Rivierwaterstanden&KL=nl`,
    };
  });
}

/** 48 hours of one Flemish gauge's level, with its thresholds. */
async function flemishSeries(no: string): Promise<RiverSeries> {
  const station = (await flemishStations()).find((s) => s.no === no);
  if (!station) throw new HttpError(404, "unknown_gauge", `Waterinfo has no gauge ${no}`);
  const values = await memo(`pulse:wi:series:${station.level}`, 5 * 60_000, () => kiwisValues([station.level], "PT48H"));
  return { id: `waterinfo:${no}`, points: (values.get(station.level) ?? []).map(([at, level]) => ({ at, level })) };
}

// ── Hub'Eau (France) ──────────────────────────────────────────────

const HUBEAU = "https://hubeau.eaufrance.fr/api/v2/hydrometrie";
const FRANCE: Bounds = { west: -5.5, south: 41.2, east: 9.8, north: 51.2 };

const HubStations = z.object({ data: z.array(z.object({ code_station: z.string(), libelle_station: z.string().nullish(), libelle_cours_eau: z.string().nullish() })) });
const HubObservations = z.object({
  data: z.array(z.object({ code_station: z.string(), date_obs: z.string(), resultat_obs: z.number().nullish(), longitude: z.number().nullish(), latitude: z.number().nullish() })),
});

/** The smallest box on a 1/`perDegree`-degree grid that contains `b`. Panning inside one cell then asks Hub'Eau for the same box. */
export function snapOut(b: Bounds, perDegree: number): Bounds {
  return { west: Math.floor(b.west * perDegree) / perDegree, south: Math.floor(b.south * perDegree) / perDegree, east: Math.ceil(b.east * perDegree) / perDegree, north: Math.ceil(b.north * perDegree) / perDegree };
}

const isoMinute = (ms: number): string => new Date(ms).toISOString().slice(0, 19);

async function france(b: Bounds): Promise<RiverGauge[]> {
  if (!overlaps(b, FRANCE)) return [];
  // Fetch a 0.1 degree grid box that covers the view and cache by it; the view itself is applied in memory.
  const g = snapOut(b, 10);
  const box = `${g.west.toFixed(1)},${g.south.toFixed(1)},${g.east.toFixed(1)},${g.north.toFixed(1)}`;
  const [names, obs] = await Promise.all([
    memo(`pulse:hubeau:stations:${box}`, 12 * HOUR_MS, async () => {
      const url = new URL(`${HUBEAU}/referentiel/stations`);
      for (const [k, v] of Object.entries({ bbox: box, format: "json", size: "500", en_service: "1", fields: "code_station,libelle_station,libelle_cours_eau" })) url.searchParams.set(k, v);
      return new Map((await fetchJson("Hub'Eau", url, HubStations)).data.map((s) => [s.code_station, s]));
    }),
    memo(`pulse:hubeau:obs:${box}`, 5 * 60_000, async () => {
      const url = new URL(`${HUBEAU}/observations_tr`);
      for (const [k, v] of Object.entries({ bbox: box, grandeur_hydro: "H", size: "5000", sort: "desc", date_debut_obs: isoMinute(Date.now() - RECENT_MS), fields: "code_station,date_obs,resultat_obs,longitude,latitude" })) url.searchParams.set(k, v);
      return fetchJson("Hub'Eau", url, HubObservations, { timeoutMs: 20_000 });
    }),
  ]);
  const byStation = new Map<string, { lat: number; lon: number; readings: Reading[] }>();
  for (const o of obs.data) {
    if (o.resultat_obs === null || o.resultat_obs === undefined || o.latitude === null || o.latitude === undefined || o.longitude === null || o.longitude === undefined) continue;
    if (!inside(b, { lat: o.latitude, lon: o.longitude })) continue;
    const entry = byStation.get(o.code_station) ?? { lat: o.latitude, lon: o.longitude, readings: [] };
    // Hub'Eau reports millimetres; every other source here reports metres.
    entry.readings.push({ at: Date.parse(o.date_obs.endsWith("Z") ? o.date_obs : `${o.date_obs}Z`), level: o.resultat_obs / 1000 });
    byStation.set(o.code_station, entry);
  }
  return [...byStation]
    .slice(0, MAX_GAUGES)
    .flatMap(([code, e]): RiverGauge[] => {
      const sum = summary(e.readings);
      if (!sum) return [];
      const meta = names.get(code);
      return [
        {
          id: `hubeau:${code}`,
          source: "Hub'Eau (France)",
          name: meta?.libelle_station ?? code,
          river: meta?.libelle_cours_eau ?? null,
          lat: e.lat,
          lon: e.lon,
          level: sum.level,
          at: sum.at,
          thresholds: null,
          status: "unknown",
          trend3h: sum.trend3h,
          url: `https://hubeau.eaufrance.fr/page/api-hydrometrie`,
        },
      ];
    });
}

async function frenchSeries(code: string): Promise<RiverSeries> {
  const url = new URL(`${HUBEAU}/observations_tr`);
  for (const [k, v] of Object.entries({ code_entite: code, grandeur_hydro: "H", size: "2000", sort: "asc", date_debut_obs: isoMinute(Date.now() - 48 * HOUR_MS), fields: "code_station,date_obs,resultat_obs" })) url.searchParams.set(k, v);
  const data = await memo(`pulse:hubeau:series:${code}`, 5 * 60_000, () => fetchJson("Hub'Eau", url, HubObservations));
  return {
    id: `hubeau:${code}`,
    points: data.data.flatMap((o) => (o.resultat_obs === null || o.resultat_obs === undefined ? [] : [{ at: Date.parse(o.date_obs.endsWith("Z") ? o.date_obs : `${o.date_obs}Z`), level: o.resultat_obs / 1000 }])),
  };
}

// ── ARPA Lombardia ────────────────────────────────────────────────

const ARPA = "https://www.dati.lombardia.it/resource";
const LOMBARDY: Bounds = { west: 8.4, south: 44.6, east: 11.5, north: 46.7 };

const ArpaStations = z.array(z.object({ idsensore: z.string(), nomestazione: z.string(), lat: z.string(), lng: z.string(), unit_dimisura: z.string().nullish() }));
const ArpaValues = z.array(z.object({ idsensore: z.string(), data: z.string(), valore: z.string(), stato: z.string().nullish() }));

interface ArpaStation {
  sensor: string;
  name: string;
  lat: number;
  lon: number;
}

const StoredArpaStations = z.array(z.object({ sensor: z.string(), name: z.string(), lat: z.number(), lon: z.number() }));

function arpaStations(): Promise<ArpaStation[]> {
  return diskMemo("pulse-arpa-level-stations", 24 * HOUR_MS, async () => {
    const url = new URL(`${ARPA}/nf78-nj6b.json`);
    url.searchParams.set("$where", "tipologia='Livello Idrometrico' AND storico='N' AND unit_dimisura='cm'");
    url.searchParams.set("$limit", "2000");
    const rows = await fetchJson("ARPA Lombardia", url, ArpaStations, { timeoutMs: 25_000 });
    return rows.map((r) => ({ sensor: r.idsensore, name: r.nomestazione, lat: Number(r.lat), lon: Number(r.lng) })).filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lon));
  }, StoredArpaStations);
}

/** ARPA stamps readings in "ora solare": UTC+1 all year. */
const arpaTime = (text: string): number => Date.parse(`${text.slice(0, 19)}Z`) - HOUR_MS;

async function arpaReadings(sensors: readonly string[], sinceMs: number): Promise<Map<string, Reading[]>> {
  const url = new URL(`${ARPA}/647i-nhxk.json`);
  url.searchParams.set("$where", `idsensore in (${sensors.map((s) => `'${s}'`).join(",")}) AND data > '${isoMinute(sinceMs + HOUR_MS)}'`);
  url.searchParams.set("$order", "data DESC");
  url.searchParams.set("$limit", "10000");
  const rows = await fetchJson("ARPA Lombardia", url, ArpaValues, { timeoutMs: 25_000 });
  const out = new Map<string, Reading[]>();
  for (const r of rows) {
    const v = Number(r.valore);
    // -9999 marks a missing value; only validated readings count.
    if (!Number.isFinite(v) || v <= -9000 || (r.stato && !["VA", "VV"].includes(r.stato))) continue;
    const list = out.get(r.idsensore) ?? [];
    list.push({ at: arpaTime(r.data), level: v / 100 });
    out.set(r.idsensore, list);
  }
  return out;
}

async function lombardy(b: Bounds): Promise<RiverGauge[]> {
  if (!overlaps(b, LOMBARDY)) return [];
  const stations = (await arpaStations()).filter((s) => inside(b, s)).slice(0, MAX_GAUGES);
  if (stations.length === 0) return [];
  const ids = stations.map((s) => s.sensor);
  const readings = await memo(`pulse:arpa:levels:${ids.join(",")}`, 5 * 60_000, () => arpaReadings(ids, Date.now() - RECENT_MS));
  return stations.flatMap((s): RiverGauge[] => {
    const sum = summary(readings.get(s.sensor) ?? []);
    if (!sum) return [];
    return [{ id: `arpa:${s.sensor}`, source: "ARPA Lombardia", name: s.name, river: null, lat: s.lat, lon: s.lon, level: sum.level, at: sum.at, thresholds: null, status: "unknown", trend3h: sum.trend3h, url: "https://www.dati.lombardia.it/d/nf78-nj6b" }];
  });
}

async function lombardSeries(sensor: string): Promise<RiverSeries> {
  const map = await memo(`pulse:arpa:series:${sensor}`, 5 * 60_000, () => arpaReadings([sensor], Date.now() - 48 * HOUR_MS));
  return { id: `arpa:${sensor}`, points: (map.get(sensor) ?? []).sort((a, b) => a.at - b.at) };
}

// ── Public ────────────────────────────────────────────────────────

export interface RiverResult {
  gauges: RiverGauge[];
  errors: string[];
}

/** Gauges inside the bounds from every source that covers them. A source that fails is reported, not hidden. */
export async function riverGauges(b: Bounds): Promise<RiverResult> {
  const sources: { name: RiverSource; load: () => Promise<RiverGauge[]> }[] = [
    { name: "Waterinfo (Flanders)", load: () => flanders(b) },
    { name: "Hub'Eau (France)", load: () => france(b) },
    { name: "ARPA Lombardia", load: () => lombardy(b) },
  ];
  const settled = await Promise.allSettled(sources.map((s) => s.load()));
  const gauges: RiverGauge[] = [];
  const errors: string[] = [];
  settled.forEach((r, i) => {
    if (r.status === "fulfilled") gauges.push(...r.value);
    else errors.push(`${sources[i]?.name}: ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`);
  });
  return { gauges: gauges.slice(0, MAX_GAUGES), errors };
}

export async function riverSeries(id: string): Promise<RiverSeries> {
  const [source, code] = id.split(":");
  if (!code) throw new HttpError(400, "bad_gauge", "Gauge ids look like waterinfo:L10_077");
  if (source === "waterinfo") return flemishSeries(code);
  if (source === "hubeau") return frenchSeries(code);
  if (source === "arpa") return lombardSeries(code);
  throw new HttpError(404, "unknown_gauge", `No river source "${source}"`);
}
