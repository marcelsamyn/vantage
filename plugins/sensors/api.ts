import { HttpError, defineSource, fetchJson, fetchUpstream, json, lat, lon, memo, parseQuery, z } from "../../server/kit";
import { airSensors, bfsSensors, highRadiation, noiseSensors, safecastSensors, street, withDistance } from "./parse";
import { RADIATION_ALERT } from "./scales";
import type { Sensor, SensorHistory, SensorKind, SensorsNear, StreetReport } from "./types";

/**
 * Sensors that tell you what is in the air, in the noise and in the ground around you.
 * - Air and noise: Sensor.Community, a network of volunteers' sensors on balconies and lamp posts.
 * - Radiation: the German Federal Office for Radiation Protection (BfS) measuring network, which publishes open data, and
 *   Safecast, volunteers' survey walks and drives.
 */

const SC_AREA = "https://data.sensor.community/airrohr/v1/filter";
const BFS_WFS = "https://www.imis.bfs.de/ogc/opendata/ows?service=WFS&version=1.1.0&request=GetFeature&outputFormat=application/json";

/** Sensor.Community asks clients to fetch the same data at most once every five minutes. */
const SC_TTL_MS = 5 * 60_000;
const MAX_AIR_RADIUS_KM = 25;

const ScRecords = z.array(
  z.object({
    timestamp: z.string(),
    location: z.object({ id: z.number(), latitude: z.string(), longitude: z.string(), indoor: z.number() }),
    sensor: z.object({ id: z.number(), sensor_type: z.object({ name: z.string() }) }),
    sensordatavalues: z.array(z.object({ value_type: z.string(), value: z.union([z.string(), z.number(), z.null()]) })),
  }),
);

const BfsFeatures = z.object({
  features: z.array(
    z.object({
      geometry: z.object({ coordinates: z.tuple([z.number(), z.number()]) }),
      properties: z.object({
        id: z.string(),
        name: z.string(),
        site_status: z.number(),
        end_measure: z.string().nullable(),
        value: z.number().nullable(),
        value_cosmic: z.number().nullable(),
        value_terrestrial: z.number().nullable(),
      }),
    }),
  ),
});

const BfsSeries = z.object({ features: z.array(z.object({ properties: z.object({ end_measure: z.string(), value: z.number().nullable() }) })) });

const SafecastRows = z.array(z.object({ value: z.number(), unit: z.string(), captured_at: z.string(), latitude: z.number(), longitude: z.number() }));

// ── Sources ───────────────────────────────────────────────────────

/** Round to ~2 km so nearby callers share one upstream request. */
const snap = (v: number): number => Math.round(v * 50) / 50;

function airNear(la: number, lo: number, radiusKm: number): Promise<Sensor[]> {
  const km = Math.min(MAX_AIR_RADIUS_KM, Math.max(1, Math.ceil(radiusKm)));
  const [cLat, cLon] = [snap(la), snap(lo)];
  return memo(`sensors:air:${cLat},${cLon},${km}`, SC_TTL_MS, async () => airSensors(await fetchJson("Sensor.Community", `${SC_AREA}/area=${cLat},${cLon},${km}`, ScRecords, { timeoutMs: 25_000 })), 30 * 60_000);
}

/** Every sound-level meter in the network, about a thousand worldwide. */
function allNoise(): Promise<Sensor[]> {
  return memo("sensors:noise", SC_TTL_MS, async () => noiseSensors(await fetchJson("Sensor.Community", `${SC_AREA}/type=DNMS%20(Laerm)`, ScRecords, { timeoutMs: 40_000 })), 30 * 60_000);
}

/** The latest hourly value of every station in the BfS network. */
function allBfs(): Promise<Sensor[]> {
  return memo("sensors:bfs", 15 * 60_000, async () => bfsSensors((await fetchJson("BfS", `${BFS_WFS}&typeName=opendata:odlinfo_odl_1h_latest`, BfsFeatures, { timeoutMs: 30_000 })).features), 2 * 3_600_000);
}

/**
 * Safecast survey readings in µSv/h within 15 km. The service lists the oldest first and stops at 1000, so the search starts
 * with the last year and widens until something is found.
 */
function safecastNear(la: number, lo: number): Promise<Sensor[]> {
  const [cLat, cLon] = [Math.round(la * 10) / 10, Math.round(lo * 10) / 10];
  return memo(
    `sensors:safecast:${cLat},${cLon}`,
    30 * 60_000,
    async () => {
      for (const years of [1, 4, 15]) {
        const since = new Date(Date.now() - years * 365 * 86_400_000).toISOString().slice(0, 10);
        const url = `https://api.safecast.org/measurements.json?distance=15000&latitude=${cLat}&longitude=${cLon}&unit=usv&captured_after=${since}&per_page=1000`;
        const found = safecastSensors(await fetchJson("Safecast", url, SafecastRows, { timeoutMs: 30_000 }));
        if (found.length > 0) return found;
      }
      return [];
    },
    24 * 3_600_000,
  );
}

async function settled<T>(id: string, task: Promise<T[]>, sources: SensorsNear["sources"]): Promise<T[]> {
  try {
    const result = await task;
    sources.push({ id, ok: true });
    return result;
  } catch (err) {
    sources.push({ id, ok: false, error: err instanceof Error ? err.message : String(err) });
    return [];
  }
}

async function sensorsOf(kind: SensorKind, la: number, lo: number, radiusKm: number): Promise<{ sensors: Sensor[]; sources: SensorsNear["sources"] }> {
  const sources: SensorsNear["sources"] = [];
  let all: Sensor[];
  if (kind === "air") all = await settled("Sensor.Community", airNear(la, lo, radiusKm), sources);
  else if (kind === "noise") all = await settled("Sensor.Community", allNoise(), sources);
  else {
    const [bfs, survey] = await Promise.all([settled("BfS", allBfs(), sources), settled("Safecast", safecastNear(la, lo), sources)]);
    all = [...bfs, ...survey];
  }
  if (sources.every((s) => !s.ok)) throw new HttpError(502, "upstream_unreachable", `${sources.map((s) => `${s.id}: ${s.error}`).join("; ")}`);
  const within = withDistance(all, { lat: la, lon: lo }).filter((s) => s.distanceM <= radiusKm * 1000);
  return { sensors: within, sources };
}

// ── History ───────────────────────────────────────────────────────

/** Mean of the values in each hour, oldest first. */
function hourly(rows: { t: number; v: number }[]): { t: number; v: number }[] {
  const buckets = new Map<number, number[]>();
  for (const r of rows) {
    const hour = Math.floor(r.t / 3_600_000) * 3_600_000;
    buckets.set(hour, [...(buckets.get(hour) ?? []), r.v]);
  }
  return [...buckets.entries()].sort((a, b) => a[0] - b[0]).map(([t, vs]) => ({ t, v: Math.round((vs.reduce((s, v) => s + v, 0) / vs.length) * 100) / 100 }));
}

const HistoryKey = z.string().regex(/^(bfs:DE[A-Z0-9]{2,10}|[a-z0-9]{3,12}:\d{1,9})$/);
/** File groups that archive.sensor.community publishes for the sensors this plugin shows. */
const ARCHIVE_SLUGS = new Set(["sds011", "pms1003", "pms3003", "pms5003", "pms6003", "pms7003", "sps30", "hpm", "laerm"]);

async function history(key: string): Promise<SensorHistory> {
  if (key.startsWith("bfs:")) {
    const id = key.slice(4);
    const url = `${BFS_WFS}&typeName=opendata:odlinfo_timeseries_odl_1h&CQL_FILTER=${encodeURIComponent(`id='${id}'`)}&sortBy=end_measure+D&maxFeatures=24`;
    const series = await fetchJson("BfS", url, BfsSeries, { timeoutMs: 20_000 });
    const points = series.features.flatMap((f) => (f.properties.value === null ? [] : [{ t: Date.parse(f.properties.end_measure), v: f.properties.value }])).sort((a, b) => a.t - b.t);
    return { points, unit: "µSv/h", window: "Last 24 hours" };
  }
  // Sensor.Community publishes whole days as files the morning after, so the latest full day is yesterday (UTC).
  const [slug, sensorId] = key.split(":");
  if (!slug || !sensorId || !ARCHIVE_SLUGS.has(slug)) throw new HttpError(400, "bad_query", "This sensor type has no archive.");
  const day = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  let res: Response;
  try {
    res = await fetchUpstream("Sensor.Community archive", `https://archive.sensor.community/${day}/${day}_${slug}_sensor_${sensorId}.csv`, { timeoutMs: 20_000 });
  } catch (err) {
    if (err instanceof HttpError && /HTTP 404/.test(err.message)) throw new HttpError(404, "no_history", "The network has no recording of this sensor for yesterday.");
    throw err;
  }
  const lines = (await res.text()).split("\n");
  const header = (lines[0] ?? "").split(";");
  const timeCol = header.indexOf("timestamp");
  const valueCol = header.indexOf(slug === "laerm" ? "noise_LAeq" : "P2");
  if (timeCol < 0 || valueCol < 0) throw new HttpError(502, "upstream_shape", "Sensor.Community archive: unexpected columns");
  const rows = lines.slice(1).flatMap((line) => {
    const f = line.split(";");
    const v = Number(f[valueCol]);
    const t = Date.parse(`${f[timeCol] ?? ""}Z`);
    return f[valueCol] !== "" && Number.isFinite(v) && Number.isFinite(t) && v >= 0 && v < 999 ? [{ t, v }] : [];
  });
  return { points: hourly(rows), unit: slug === "laerm" ? "dB(A)" : "µg/m³", window: "Yesterday (UTC)" };
}

/** A station that is above the alert level must also have been above it the hour before, so one bad sample raises no alarm. */
async function confirmed(s: Sensor): Promise<boolean> {
  if (!s.historyKey?.startsWith("bfs:")) return false;
  const h = await memo(`sensors:history:${s.historyKey}`, 10 * 60_000, () => history(s.historyKey as string));
  const [previous] = h.points.slice(-2);
  return previous !== undefined && previous.v > RADIATION_ALERT && s.value > RADIATION_ALERT;
}

export default defineSource({
  probes: [
    { name: "Air and noise sensors · Sensor.Community", url: "https://data.sensor.community/airrohr/v1/sensor/1/" },
    { name: "Radiation · BfS ODL", url: "https://www.imis.bfs.de/ogc/opendata/ows?service=WFS&version=1.1.0&request=GetCapabilities" },
  ],
  routes: {
    "GET /near": async (req) => {
      const q = parseQuery(req, z.object({ kind: z.enum(["air", "noise", "radiation"]), lat, lon, radiusKm: z.coerce.number().min(1).max(5000).default(25) }));
      const { sensors, sources } = await sensorsOf(q.kind, q.lat, q.lon, q.radiusKm);
      return json({ center: { lat: q.lat, lon: q.lon }, radiusKm: q.radiusKm, fetchedAt: Date.now(), sensors: sensors.slice(0, 1500), sources } satisfies SensorsNear, { maxAge: 60 });
    },

    "GET /street": async (req) => {
      const q = parseQuery(req, z.object({ lat, lon }));
      const at = { lat: q.lat, lon: q.lon };
      const sources: SensorsNear["sources"] = [];
      const [air, noise, bfs, survey] = await Promise.all([
        settled("Sensor.Community air", airNear(q.lat, q.lon, MAX_AIR_RADIUS_KM), sources),
        settled("Sensor.Community noise", allNoise(), sources),
        settled("BfS", allBfs(), sources),
        settled("Safecast", safecastNear(q.lat, q.lon), sources),
      ]);
      // One network being down must not blank the tile; all of them being down is an error worth showing.
      if (sources.every((s) => !s.ok)) throw new HttpError(502, "upstream_unreachable", `No sensor network answered: ${sources.map((s) => `${s.id}: ${s.error}`).join("; ")}`);
      const radiation = [...bfs, ...survey];
      const report = street(at, air, noise, radiation);
      const high = highRadiation(radiation, at);
      const alerts = (await Promise.all(high.map(async (s) => ((await confirmed(s).catch(() => false)) ? [s] : [])))).flat();
      return json({ ...report, fetchedAt: Date.now(), radiationAlerts: alerts } satisfies StreetReport, { maxAge: 60 });
    },

    "GET /history": async (req) => {
      const { key } = parseQuery(req, z.object({ key: HistoryKey }));
      return json(await memo(`sensors:history:${key}`, 10 * 60_000, () => history(key)), { maxAge: 300 });
    },
  },
});

