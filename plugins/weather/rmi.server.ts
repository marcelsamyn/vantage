import { describe, diskMemo, fetchUpstream, HttpError, memo, parseUpstream, z } from "../../server/kit";
import { distanceM, type LatLon } from "../../shared/geo";
import type { BelgiumWeather, Ceilometer, CloudLayer, CrowdReports, SoilTemps } from "./types";

/**
 * Belgium's Royal Meteorological Institute open data (CC BY 4.0), read through its WFS: laser ceilometers (cloud base),
 * the automatic weather stations (soil temperature) and the crowd weather reports sent from the RMI app.
 * The WFS is a small GeoServer that sometimes runs out of database connections, so every call retries briefly.
 */

const WFS = "https://opendata.meteo.be/geoserver/ows";
/** A station farther away than this says nothing about the sky or soil at your spot. */
const MAX_CEILOMETER_KM = 80;
const MAX_SOIL_KM = 60;
const CROWD_RADIUS_KM = 20;
const CROWD_HOURS = 24;
const ATTEMPTS = 3;

// ── Pure helpers (tested) ────────────────────────────────────────

export interface Station extends LatLon {
  code: number;
  name: string;
}

export function nearest(stations: readonly Station[], at: LatLon, maxKm: number): { station: Station; distanceKm: number } | null {
  let best: { station: Station; distanceKm: number } | null = null;
  for (const station of stations) {
    const distanceKm = distanceM(at, station) / 1000;
    if (distanceKm <= maxKm && (!best || distanceKm < best.distanceKm)) best = { station, distanceKm };
  }
  return best && { ...best, distanceKm: Math.round(best.distanceKm) };
}

/** The ceilometer writes -999 for "no value". A real height is above zero. */
const height = (v: number | null | undefined): number | null => (typeof v === "number" && v > 0 ? v : null);

export interface LidarRow {
  lowest_cloud_base_height_1: number | null;
  cloud_layer_1_height: number | null;
  cloud_layer_1_amount: number | null;
  cloud_layer_2_height: number | null;
  cloud_layer_2_amount: number | null;
  cloud_layer_3_height: number | null;
  cloud_layer_3_amount: number | null;
}

export function cloudLayers(row: LidarRow): CloudLayer[] {
  const layers: CloudLayer[] = [];
  for (const [h, a] of [
    [row.cloud_layer_1_height, row.cloud_layer_1_amount],
    [row.cloud_layer_2_height, row.cloud_layer_2_amount],
    [row.cloud_layer_3_height, row.cloud_layer_3_amount],
  ] as const) {
    const heightM = height(h);
    if (heightM !== null && typeof a === "number" && a > 0) layers.push({ heightM, oktas: a });
  }
  return layers;
}

export const cloudBase = (row: LidarRow): number | null => height(row.lowest_cloud_base_height_1);

/** The box that holds everything within `km` of a point, as the WFS wants it: latitude first. */
export function boxAround(at: LatLon, km: number): [number, number, number, number] {
  const dLat = km / 111.32;
  const dLon = km / (111.32 * Math.cos((at.lat * Math.PI) / 180));
  return [at.lat - dLat, at.lon - dLon, at.lat + dLat, at.lon + dLon];
}

export function tally(kinds: readonly string[]): { kind: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const kind of kinds) counts.set(kind, (counts.get(kind) ?? 0) + 1);
  return [...counts].map(([kind, count]) => ({ kind, count })).sort((a, b) => b.count - a.count || a.kind.localeCompare(b.kind));
}

// ── WFS access ─────────────────────────────────────────────────

const Point = z.object({ coordinates: z.tuple([z.number(), z.number()]) });
const collection = <P extends z.ZodType>(properties: P) => z.object({ features: z.array(z.object({ geometry: Point.nullable().optional(), properties })) });

/**
 * A busy or slow GeoServer is worth another try. A 429 or any other 4xx is an answer: asking again at once only adds load
 * (`fetchUpstream` reports every bad status as `upstream_status`, so the number is read from its message).
 */
export function worthRetrying(err: HttpError): boolean {
  if (err.code === "upstream_busy" || err.code === "upstream_timeout") return true;
  return err.code === "upstream_status" && /HTTP 5\d\d$/.test(err.message);
}

async function wfs(params: Record<string, string>, format: "json" | "xml" = "json"): Promise<unknown> {
  const url = new URL(WFS);
  const query = { service: "WFS", version: "2.0.0", request: "GetFeature", outputFormat: format === "json" ? "application/json" : "text/xml", ...params };
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  let failure: HttpError | null = null;
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    if (attempt > 0) await Bun.sleep(1500 * attempt);
    try {
      const res = await fetchUpstream("RMI open data", url, { timeoutMs: 20_000 });
      const text = await res.text();
      // GeoServer reports a database hiccup as an XML error with HTTP 200.
      if (format === "json" && !text.startsWith("{")) throw new HttpError(502, "upstream_busy", `RMI open data is busy: ${/<ows:ExceptionText>([^<]{0,120})/.exec(text)?.[1]?.trim() ?? "no data returned"}`);
      return format === "json" ? JSON.parse(text) : text;
    } catch (err) {
      if (!(err instanceof HttpError) || !worthRetrying(err)) throw err;
      failure = err;
    }
  }
  throw failure ?? new HttpError(502, "upstream_busy", "RMI open data did not answer");
}

const sinceIso = (hours: number): string => new Date(Date.now() - hours * 3_600_000).toISOString().replace(/\.\d+Z$/, "Z");

const StationProps = z.object({ code: z.number(), name: z.string(), date_end: z.string().nullable() });
const StoredStation = z.object({ code: z.number(), name: z.string(), lat: z.number(), lon: z.number() });

/** Active stations of one RMI network, from the layer's own station table. */
async function stationsOf(layer: "aws:aws_station" | "lidar:lidar_station"): Promise<Station[]> {
  return diskMemo(`rmi-${layer.replace(":", "-")}`, 24 * 3_600_000, async () => {
    const data = parseUpstream("RMI stations", collection(StationProps), await wfs({ typeNames: layer, count: "200" }));
    return data.features.flatMap((f) => {
      const c = f.geometry?.coordinates;
      return c && f.properties.date_end === null ? [{ code: f.properties.code, name: titleCase(f.properties.name), lat: c[1], lon: c[0] }] : [];
    });
  }, z.array(StoredStation));
}

const titleCase = (s: string): string => s.toLowerCase().replace(/(^|[\s-])\p{L}/gu, (m) => m.toUpperCase());

const Num = z.number().nullable();
const LidarProps = z.object({
  timestamp: z.string(),
  lowest_cloud_base_height_1: Num,
  cloud_layer_1_height: Num,
  cloud_layer_1_amount: Num,
  cloud_layer_2_height: Num,
  cloud_layer_2_amount: Num,
  cloud_layer_3_height: Num,
  cloud_layer_3_amount: Num,
});

async function ceilometer(at: LatLon): Promise<Ceilometer | null> {
  const found = nearest(await stationsOf("lidar:lidar_station"), at, MAX_CEILOMETER_KM);
  if (!found) return null;
  const { station, distanceKm } = found;
  const row = await memo(`rmi:lidar:${station.code}`, 5 * 60_000, async () => {
    const data = parseUpstream("RMI ceilometer", collection(LidarProps), await wfs({ typeNames: "lidar:lidar_measures", cql_filter: `code=${station.code} AND timestamp > ${sinceIso(3)}`, count: "40" }));
    return data.features.map((f) => f.properties).sort((a, b) => a.timestamp.localeCompare(b.timestamp)).at(-1) ?? null;
  });
  if (!row) return null;
  return { station: station.name, distanceKm, at: row.timestamp, baseM: cloudBase(row), layers: cloudLayers(row) };
}

const AwsProps = z.object({
  timestamp: z.string(),
  temp_dry_shelter_avg: Num,
  temp_soil_avg_5cm: Num,
  temp_soil_avg_10cm: Num,
  temp_soil_avg_20cm: Num,
  temp_soil_avg_50cm: Num,
});

async function soil(at: LatLon): Promise<SoilTemps | null> {
  const found = nearest(await stationsOf("aws:aws_station"), at, MAX_SOIL_KM);
  if (!found) return null;
  const { station, distanceKm } = found;
  const row = await memo(`rmi:aws:${station.code}`, 5 * 60_000, async () => {
    const data = parseUpstream("RMI weather stations", collection(AwsProps), await wfs({ typeNames: "aws:aws_10min", cql_filter: `code=${station.code} AND timestamp > ${sinceIso(3)}`, count: "40" }));
    return data.features.map((f) => f.properties).sort((a, b) => a.timestamp.localeCompare(b.timestamp)).at(-1) ?? null;
  });
  if (!row) return null;
  const depths = [
    { cm: 5, c: row.temp_soil_avg_5cm },
    { cm: 10, c: row.temp_soil_avg_10cm },
    { cm: 20, c: row.temp_soil_avg_20cm },
    { cm: 50, c: row.temp_soil_avg_50cm },
  ].flatMap((d) => (d.c === null ? [] : [{ cm: d.cm, c: d.c }]));
  if (depths.length === 0) return null;
  return { station: station.name, distanceKm, at: row.timestamp, airC: row.temp_dry_shelter_avg, depths };
}

const CrowdProps = z.object({ obs_type_description: z.string() });

/** Counts of weather reports from the RMI app. The reports carry phone positions, so only the counts leave this function. */
async function crowd(at: LatLon): Promise<CrowdReports> {
  // Round to the 0.05° grid so neighbouring requests share one upstream call.
  const cell = { lat: Math.round(at.lat * 20) / 20, lon: Math.round(at.lon * 20) / 20 };
  const [south, west, north, east] = boxAround(cell, CROWD_RADIUS_KM);
  const [kinds, country] = await Promise.all([
    memo(`rmi:crowd:${cell.lat},${cell.lon}`, 10 * 60_000, async () => {
      const data = parseUpstream(
        "RMI crowd reports",
        collection(CrowdProps),
        await wfs({ typeNames: "appobs:observations", cql_filter: `timestamp > ${sinceIso(CROWD_HOURS)} AND BBOX(the_geom,${south},${west},${north},${east})`, propertyName: "obs_type_description", count: "2000" }),
      );
      // The feed pads some labels ("Flood ") with a trailing space.
      return data.features.map((f) => f.properties.obs_type_description.trim());
    }),
    memo("rmi:crowd:country", 10 * 60_000, async () => {
      const xml = await wfs({ typeNames: "appobs:observations", cql_filter: `timestamp > ${sinceIso(CROWD_HOURS)}`, resultType: "hits" }, "xml");
      const n = Number(/numberMatched="(\d+)"/.exec(String(xml))?.[1]);
      if (!Number.isFinite(n)) throw new HttpError(502, "upstream_shape", "RMI open data did not say how many reports there are");
      return n;
    }),
  ]);
  return { radiusKm: CROWD_RADIUS_KM, hours: CROWD_HOURS, nearby: kinds.length, country, byKind: tally(kinds) };
}

/** Fails only when all three parts fail; otherwise a failed part is null and listed in `unavailable`. */
export async function belgiumWeather(at: LatLon): Promise<BelgiumWeather> {
  const [c, s, w] = await Promise.allSettled([ceilometer(at), soil(at), crowd(at)]);
  if (c.status === "rejected" && s.status === "rejected" && w.status === "rejected") throw c.reason;
  const unavailable: BelgiumWeather["unavailable"] = [];
  const read = <T>(part: "ceilometer" | "soil" | "crowd", r: PromiseSettledResult<T>): T | null => {
    if (r.status === "fulfilled") return r.value;
    unavailable.push({ part, message: describe(r.reason) });
    return null;
  };
  return { ceilometer: read("ceilometer", c), soil: read("soil", s), crowd: read("crowd", w), unavailable };
}
