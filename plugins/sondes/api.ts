import { HttpError, defineSource, diskMemo, fetchJson, json, log, memo, parseQuery, z } from "../../server/kit";
import { distanceM } from "../../shared/geo";
import { callsignOf, loadBalloons, loadFlight } from "./amateur.server";
import type { AmateurSnapshot, LaunchSite, PathPoint, Sonde, SondePhase, SondePrediction, SondeSnapshot, SondeTrack, TrackPoint } from "./types";

/**
 * Weather balloons from SondeHub (https://sondehub.org), where volunteers share the radio signals of
 * radiosondes they decode with a cheap SDR. Every position here is broadcast openly by the sonde itself.
 * The feed also carries the receiver's call sign and location; those describe a person and are dropped here.
 */

const BASE = "https://api.v2.sondehub.org";

/** Newest frame per balloon heard in the past two hours. Landed balloons stay visible long enough to be recovered. */
const WINDOW_S = 7200;
/** A balloon that has not been heard for this long is no longer flying. */
const STALE_S = 240;
const MAX_PATH_POINTS = 28;

// ── Live balloons ─────────────────────────────────────────────────

const Frame = z.object({
  serial: z.string(),
  type: z.string(),
  subtype: z.string().optional(),
  manufacturer: z.string().optional(),
  datetime: z.string(),
  lat: z.number(),
  lon: z.number(),
  alt: z.number(),
  vel_h: z.number().optional(),
  vel_v: z.number().optional(),
  heading: z.number().optional(),
  temp: z.number().optional(),
  humidity: z.number().optional(),
  pressure: z.number().optional(),
  frequency: z.number().optional(),
  tx_frequency: z.number().optional(),
  batt: z.number().optional(),
});
type Frame = z.infer<typeof Frame>;

const PredictionPoint = z.object({ time: z.number(), lat: z.number(), lon: z.number(), alt: z.number() });
const Prediction = z.object({
  vehicle: z.string(),
  time: z.string(),
  descending: z.number(),
  data: z.string(),
});

/** CloudFront occasionally drops a kept-alive socket between refreshes; one retry opens a fresh connection. */
async function fetchSondeHub<S extends z.ZodType>(source: string, url: string, schema: S, timeoutMs: number): Promise<z.infer<S>> {
  try {
    return await fetchJson(source, url, schema, { timeoutMs });
  } catch (err) {
    if (err instanceof HttpError && err.code === "upstream_unreachable") return fetchJson(source, url, schema, { timeoutMs });
    throw err;
  }
}

const round = (n: number, places: number): number => Math.round(n * 10 ** places) / 10 ** places;

/** Keep the first and last points and every point where the path peaks; thin the rest evenly. */
function thin<T extends { altM: number }>(points: T[], max: number): T[] {
  if (points.length <= max) return points;
  const peak = points.reduce((best, p, i) => (p.altM > (points[best]?.altM ?? -Infinity) ? i : best), 0);
  const keep = new Set<number>([0, points.length - 1, peak]);
  const stride = (points.length - 1) / (max - 1);
  for (let i = 0; i < max; i++) keep.add(Math.round(i * stride));
  return [...keep].sort((a, b) => a - b).map((i) => points[i] as T);
}

function parsePrediction(raw: z.infer<typeof Prediction>, seenAt: number): SondePrediction | null {
  let path: PathPoint[];
  try {
    const points = z.array(PredictionPoint).parse(JSON.parse(raw.data));
    path = points.map((p) => ({ lat: round(p.lat, 4), lon: round(p.lon, 4), altM: Math.round(p.alt), at: p.time * 1000 }));
  } catch {
    return null;
  }
  const updatedAt = Date.parse(raw.time);
  // A prediction left over from an earlier flight state says nothing about where the balloon is going now.
  if (!Number.isFinite(updatedAt) || Math.abs(updatedAt - seenAt) > 20 * 60_000) return null;
  const landing = path.at(-1);
  if (!landing || path.length < 2) return null;
  const peak = path.reduce((best, p) => (p.altM > best.altM ? p : best), path[0] as PathPoint);
  return { updatedAt, path: thin(path, MAX_PATH_POINTS), burst: raw.descending === 0 ? peak : null, landing };
}

function phaseOf(f: Frame, seenAt: number, now: number): SondePhase {
  const horizontal = f.vel_h ?? 0;
  const vertical = f.vel_v ?? 0;
  // A sonde sitting still low down is on the ground: landed, or waiting to be launched.
  if (horizontal < 2 && Math.abs(vertical) < 1 && f.alt < 5000) return "ground";
  if ((now - seenAt) / 1000 > STALE_S) return vertical < -2 && f.alt < 6000 ? "ground" : "lost";
  if (vertical > 1) return "ascending";
  if (vertical < -1) return "descending";
  return "floating";
}

function toSonde(f: Frame, prediction: z.infer<typeof Prediction> | undefined, now: number): Sonde | null {
  const seenAt = Date.parse(f.datetime);
  if (!Number.isFinite(seenAt)) return null;
  const phase = phaseOf(f, seenAt, now);
  return {
    serial: f.serial,
    type: f.type,
    subtype: f.subtype ?? null,
    manufacturer: f.manufacturer ?? null,
    lat: f.lat,
    lon: f.lon,
    altM: f.alt,
    speedMs: f.vel_h ?? null,
    vertMs: f.vel_v ?? null,
    headingDeg: f.heading ?? null,
    tempC: f.temp ?? null,
    humidityPct: f.humidity ?? null,
    pressureHpa: f.pressure ?? null,
    // The configured channel is a round number; the measured one drifts by a few hundred hertz.
    frequencyMHz: f.tx_frequency ?? (f.frequency === undefined ? null : round(f.frequency, 3)),
    battV: f.batt ?? null,
    seenAt,
    phase,
    prediction: prediction && phase !== "ground" && phase !== "lost" ? parsePrediction(prediction, seenAt) : null,
  };
}

async function loadSnapshot(): Promise<SondeSnapshot> {
  const [latest, predictions] = await Promise.all([
    fetchSondeHub("SondeHub", `${BASE}/sondes?last=${WINDOW_S}`, z.record(z.string(), z.unknown()), 15_000),
    fetchSondeHub("SondeHub predictions", `${BASE}/predictions`, z.array(z.unknown()), 15_000).then(
      (list) => list,
      (err: unknown) => {
        log.warn("sondehub predictions unavailable", { error: err instanceof Error ? err.message : String(err) });
        return null;
      },
    ),
  ]);

  const byVehicle = new Map<string, z.infer<typeof Prediction>>();
  for (const item of predictions ?? []) {
    const p = Prediction.safeParse(item);
    if (p.success) byVehicle.set(p.data.vehicle, p.data);
  }

  const now = Date.now();
  const sondes: Sonde[] = [];
  for (const raw of Object.values(latest)) {
    const frame = Frame.safeParse(raw);
    if (!frame.success) continue;
    const sonde = toSonde(frame.data, byVehicle.get(frame.data.serial), now);
    if (sonde) sondes.push(sonde);
  }
  const total = Object.keys(latest).length;
  if (total > 0 && sondes.length === 0) throw new HttpError(502, "upstream_shape", "SondeHub sent balloon data in a format VANTAGE does not recognise");
  return { fetchedAt: now, predictionsAvailable: predictions !== null, sondes };
}

// ── Launch sites ──────────────────────────────────────────────────

const Site = z.object({
  station: z.string(),
  station_name: z.string(),
  position: z.tuple([z.number(), z.number()]),
  alt: z.number().optional(),
  times: z.array(z.string()).optional(),
  burst_altitude: z.number().optional(),
  ascent_rate: z.number().optional(),
});

/**
 * SondeHub writes launch times as "D:HH:MM". Day 0 means every day; other values name a single weekday,
 * which this plugin does not use, so only daily times are kept.
 */
function dailyHours(times: string[] | undefined): string[] {
  const out: string[] = [];
  for (const t of times ?? []) {
    const m = /^0:(\d{1,2}):(\d{2})$/.exec(t);
    if (m) out.push(`${m[1]?.padStart(2, "0")}:${m[2]}`);
  }
  return [...new Set(out)].sort();
}

const StoredSite = z.object({
  id: z.string(),
  name: z.string(),
  lat: z.number(),
  lon: z.number(),
  altM: z.number().nullable(),
  dailyUtc: z.array(z.string()),
  burstAltM: z.number().nullable(),
  ascentMs: z.number().nullable(),
});

async function loadSites(): Promise<LaunchSite[]> {
  const raw = await fetchSondeHub("SondeHub sites", `${BASE}/sites`, z.record(z.string(), z.unknown()), 20_000);
  const sites: LaunchSite[] = [];
  for (const item of Object.values(raw)) {
    const s = Site.safeParse(item);
    if (!s.success) continue;
    const [lon, lat] = s.data.position;
    sites.push({
      id: s.data.station,
      name: s.data.station_name,
      lat,
      lon,
      altM: s.data.alt ?? null,
      dailyUtc: dailyHours(s.data.times),
      burstAltM: s.data.burst_altitude ?? null,
      ascentMs: s.data.ascent_rate ?? null,
    });
  }
  if (sites.length === 0) throw new HttpError(502, "upstream_shape", "SondeHub sent no launch sites");
  return sites;
}

// ── Recorded flight ───────────────────────────────────────────────

const TrackFrames = z.record(z.string(), z.object({ datetime: z.string(), lat: z.number(), lon: z.number(), alt: z.number() }));

async function loadTrack(serial: string): Promise<SondeTrack> {
  const url = `${BASE}/sondes/telemetry?serial=${encodeURIComponent(serial)}&duration=12h`;
  const res = await fetchSondeHub("SondeHub telemetry", url, z.record(z.string(), TrackFrames), 25_000);
  const frames = res[serial];
  if (!frames) throw new HttpError(404, "no_flight", `SondeHub has no recent flight for ${serial}`);
  const all: TrackPoint[] = Object.values(frames)
    .map((f) => ({ lat: f.lat, lon: f.lon, altM: f.alt, at: Date.parse(f.datetime) }))
    .filter((p) => Number.isFinite(p.at))
    .sort((a, b) => a.at - b.at);
  const first = all[0];
  if (!first) throw new HttpError(404, "no_flight", `SondeHub has no recent flight for ${serial}`);

  const peak = all.reduce((best, p) => (p.altM > best.altM ? p : best), first);
  const last = all.at(-1) as TrackPoint;
  // The balloon burst when it has fallen well below its peak.
  const burst = peak.altM - last.altM > 1000 ? peak : null;

  const sites = await diskMemo("sondes-sites", 12 * 3_600_000, loadSites, z.array(StoredSite));
  let site: { name: string; distanceKm: number } | null = null;
  for (const s of sites) {
    const d = distanceM(first, s);
    if (d < 30_000 && (!site || d / 1000 < site.distanceKm)) site = { name: s.name, distanceKm: round(d / 1000, 1) };
  }
  const points = thin(all, 160).map((p) => ({ lat: round(p.lat, 5), lon: round(p.lon, 5), altM: Math.round(p.altM), at: p.at }));
  return { serial, points, burst, launch: { lat: first.lat, lon: first.lon, at: first.at, site } };
}

export default defineSource({
  probes: [
    { name: "Weather balloons · SondeHub", url: `${BASE}/sondes?last=60&lat=0&lon=0&distance=1000` },
    { name: "Amateur balloons · SondeHub", url: `${BASE}/amateur/telemetry?duration=1m` },
  ],
  routes: {
    "GET /live": async () => {
      const snapshot = await memo("sondes:live", 25_000, loadSnapshot, 5 * 60_000);
      return json(snapshot);
    },

    "GET /sites": async () => {
      const sites = await diskMemo("sondes-sites", 12 * 3_600_000, loadSites, z.array(StoredSite));
      return json(sites, { maxAge: 3600 });
    },

    "GET /balloons": async () => {
      // SondeHub asks clients not to poll this database; ten minutes keeps one request per ten minutes however many tabs are open.
      const balloons = await memo("sondes:amateur", 10 * 60_000, loadBalloons, 60 * 60_000);
      return json({ fetchedAt: Date.now(), balloons } satisfies AmateurSnapshot);
    },

    "GET /balloon": async (req) => {
      const q = parseQuery(req, z.object({ id: z.string().regex(/^[0-9a-f]{8}$/) }));
      // The live list fills the id-to-call-sign table, so load it before looking the id up.
      await memo("sondes:amateur", 10 * 60_000, loadBalloons, 60 * 60_000);
      const callsign = callsignOf(q.id);
      return json(await memo(`sondes:amateur:${q.id}`, 30 * 60_000, () => loadFlight(q.id, callsign), 6 * 3_600_000));
    },

    "GET /track": async (req) => {
      const q = parseQuery(req, z.object({ serial: z.string().regex(/^[A-Za-z0-9_-]{4,24}$/) }));
      const track = await memo(`sondes:track:${q.serial}`, 30_000, () => loadTrack(q.serial), 10 * 60_000);
      return json(track);
    },
  },
});
