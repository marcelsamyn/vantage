import { HttpError, defineSource, describe, diskMemo, fetchJson, json, lat, lon, memo, parseQuery, z } from "../../server/kit";
import { loadCosmicRays, loadField, loadIonosphere } from "./shields.server";
import type { Approach, AsteroidsInfo, AuroraGrid, AuroraPoint, Fireball, KpInfo, KpSlot, Section, Shields, SpaceWeatherNow, WindInfo, WindSample, XrayInfo } from "./types";

/**
 * Space weather from NOAA's Space Weather Prediction Center (services.swpc.noaa.gov) and close approaches
 * and fireballs from NASA/JPL's Solar System Dynamics group (ssd-api.jpl.nasa.gov). Both are public, keyless JSON.
 */

const SWPC = "https://services.swpc.noaa.gov";
const JPL = "https://ssd-api.jpl.nasa.gov";
const MIN = 60_000;
const HOUR = 3_600_000;

const utc = (tag: string): number => Date.parse(tag.endsWith("Z") ? tag : `${tag}Z`);

/** Evenly thin a series to about `max` points, always keeping the last one. */
function thin<T>(items: T[], max: number): T[] {
  if (items.length <= max) return items;
  const stride = (items.length - 1) / (max - 1);
  const out: T[] = [];
  for (let i = 0; i < max; i++) out.push(items[Math.round(i * stride)] as T);
  return out;
}

async function section<T>(load: () => Promise<T>): Promise<Section<T>> {
  try {
    return { ok: true, data: await load() };
  } catch (err) {
    return { ok: false, error: describe(err) };
  }
}

// ── Kp ────────────────────────────────────────────────────────────

/** NOAA G-scale from a Kp value. NOAA counts 5− (4.67) as G1, 6− as G2, and so on. */
const gScale = (kp: number): number => Math.max(0, Math.min(5, Math.floor(kp + 0.34) - 4));

const KpNow = z.array(z.object({ time_tag: z.string(), estimated_kp: z.number() }));
const KpForecast = z.array(z.object({ time_tag: z.string(), kp: z.number(), observed: z.enum(["observed", "estimated", "predicted"]) }));

async function loadKp(): Promise<KpInfo> {
  const [minute, forecast] = await Promise.all([
    fetchJson("NOAA SWPC Kp", `${SWPC}/json/planetary_k_index_1m.json`, KpNow),
    fetchJson("NOAA SWPC Kp forecast", `${SWPC}/products/noaa-planetary-k-index-forecast.json`, KpForecast),
  ]);
  const latest = minute.at(-1);
  if (!latest) throw new HttpError(502, "upstream_shape", "NOAA SWPC sent no Kp readings");
  const today = new Date();
  const startOfToday = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const slots: KpSlot[] = forecast
    .map((s): KpSlot => ({ at: utc(s.time_tag), kp: s.kp, kind: s.observed, scale: gScale(s.kp) }))
    .filter((s) => s.at >= startOfToday);
  return { now: latest.estimated_kp, at: utc(latest.time_tag), scale: gScale(latest.estimated_kp), slots };
}

// ── Solar wind ────────────────────────────────────────────────────

const WindRows = z.array(z.object({ time_tag: z.string(), active: z.boolean(), source: z.string(), proton_speed: z.number().nullable().optional(), proton_density: z.number().nullable().optional() }));
const MagRows = z.array(z.object({ time_tag: z.string(), active: z.boolean(), source: z.string(), bz_gsm: z.number().nullable().optional() }));

async function loadWind(): Promise<WindInfo> {
  const [plasma, mag] = await Promise.all([
    fetchJson("NOAA SWPC solar wind", `${SWPC}/json/rtsw/rtsw_wind_1m.json`, WindRows, { timeoutMs: 20_000 }),
    fetchJson("NOAA SWPC magnetic field", `${SWPC}/json/rtsw/rtsw_mag_1m.json`, MagRows, { timeoutMs: 20_000 }),
  ]);
  // Each file mixes several spacecraft; the one flagged active is the one NOAA currently relies on.
  const byTime = new Map<number, WindSample>();
  let source = "";
  for (const r of plasma) {
    if (!r.active) continue;
    source = r.source;
    const at = utc(r.time_tag);
    byTime.set(at, { at, speed: r.proton_speed ?? null, density: r.proton_density ?? null, bz: null });
  }
  for (const r of mag) {
    if (!r.active) continue;
    const at = utc(r.time_tag);
    const sample = byTime.get(at) ?? { at, speed: null, density: null, bz: null };
    sample.bz = r.bz_gsm ?? null;
    byTime.set(at, sample);
  }
  const all = [...byTime.values()].sort((a, b) => a.at - b.at);
  const latest = all.at(-1);
  if (!latest) throw new HttpError(502, "upstream_shape", "NOAA SWPC sent no active solar wind readings");
  const lastOf = (pick: (s: WindSample) => number | null): number | null => {
    for (let i = all.length - 1; i >= 0; i--) {
      const v = pick(all[i] as WindSample);
      if (v !== null) return v;
    }
    return null;
  };
  const recent = all.filter((s) => s.at >= latest.at - 3 * HOUR);
  return { at: latest.at, speedKmS: lastOf((s) => s.speed), densityCm3: lastOf((s) => s.density), bzNt: lastOf((s) => s.bz), series: thin(recent, 72), source };
}

// ── X-rays ────────────────────────────────────────────────────────

const XrayRows = z.array(z.object({ time_tag: z.string(), flux: z.number(), energy: z.string() }));
const FlareRows = z.array(z.object({ begin_time: z.string(), max_time: z.string(), end_time: z.string().nullable().optional(), max_class: z.string() }));

/** Flare class from long-channel flux: A, B, C, M and X are decades from 1e-8 W/m². */
function fluxClass(flux: number): string {
  const decades = [
    ["X", 1e-4],
    ["M", 1e-5],
    ["C", 1e-6],
    ["B", 1e-7],
    ["A", 1e-8],
  ] as const;
  for (const [letter, base] of decades) if (flux >= base) return `${letter}${(flux / base).toFixed(1)}`;
  return `A${Math.max(0, flux / 1e-8).toFixed(1)}`;
}

async function loadXray(): Promise<XrayInfo> {
  const [rows, flares] = await Promise.all([
    fetchJson("NOAA SWPC X-ray flux", `${SWPC}/json/goes/primary/xrays-6-hour.json`, XrayRows, { timeoutMs: 20_000 }),
    fetchJson("NOAA SWPC flares", `${SWPC}/json/goes/primary/xray-flares-latest.json`, FlareRows),
  ]);
  const series = rows
    .filter((r) => r.energy === "0.1-0.8nm" && r.flux > 0)
    .map((r) => ({ at: utc(r.time_tag), flux: r.flux }))
    .sort((a, b) => a.at - b.at);
  const latest = series.at(-1);
  if (!latest) throw new HttpError(502, "upstream_shape", "NOAA SWPC sent no X-ray readings");
  const f = flares[0];
  return {
    at: latest.at,
    fluxWm2: latest.flux,
    class: fluxClass(latest.flux),
    series: thin(series, 90),
    flare: f ? { class: f.max_class, beganAt: utc(f.begin_time), peakAt: utc(f.max_time), endedAt: f.end_time ? utc(f.end_time) : null } : null,
  };
}

// ── Aurora (OVATION) ──────────────────────────────────────────────

const GRID_W = 360;
const GRID_H = 181;
const Ovation = z.object({
  "Observation Time": z.string(),
  "Forecast Time": z.string(),
  coordinates: z.array(z.tuple([z.number(), z.number(), z.number()])),
});
interface Aurora {
  observedAt: number;
  forecastAt: number;
  cells: Uint8Array;
}

async function loadAurora(): Promise<Aurora> {
  const d = await fetchJson("NOAA SWPC OVATION aurora", `${SWPC}/json/ovation_aurora_latest.json`, Ovation, { timeoutMs: 20_000 });
  const cells = new Uint8Array(GRID_W * GRID_H);
  for (const [lo, la, p] of d.coordinates) {
    const col = Math.round(lo) % GRID_W;
    const row = Math.round(la) + 90;
    if (row < 0 || row >= GRID_H) continue;
    cells[row * GRID_W + col] = Math.max(0, Math.min(100, Math.round(p)));
  }
  return { observedAt: utc(d["Observation Time"]), forecastAt: utc(d["Forecast Time"]), cells };
}

const aurora = (): Promise<Aurora> => memo("spacewx:aurora", 5 * MIN, loadAurora, HOUR);

/** Bilinear lookup, so a point between grid cells gets a smooth value. Longitude wraps around. */
function chanceAt(cells: Uint8Array, la: number, lo: number): number {
  const y = Math.max(0, Math.min(GRID_H - 1, la + 90));
  const x = ((lo % 360) + 360) % 360;
  const y0 = Math.floor(y);
  const y1 = Math.min(GRID_H - 1, y0 + 1);
  const x0 = Math.floor(x) % GRID_W;
  const x1 = (x0 + 1) % GRID_W;
  const fy = y - y0;
  const fx = x - Math.floor(x);
  const at = (r: number, c: number): number => cells[r * GRID_W + c] ?? 0;
  const top = at(y0, x0) * (1 - fx) + at(y0, x1) * fx;
  const bottom = at(y1, x0) * (1 - fx) + at(y1, x1) * fx;
  return top * (1 - fy) + bottom * fy;
}

/** Aurora hangs about 100 km up, so it shows low on the horizon from roughly this many degrees of latitude beyond the oval's edge. */
const HORIZON_REACH_DEG = 5;
/** Probability that counts as the oval's edge. */
const EDGE_PCT = 10;
/** Columns either side of yours that count as "your meridian"; the oval is lumpy, so one column is too noisy. */
const MERIDIAN_BAND = 10;

/** Equatorward edge of the oval in the given hemisphere near `lo`, as a signed latitude, or null if nothing reaches EDGE_PCT. */
function ovalEdge(cells: Uint8Array, la: number, lo: number): number | null {
  const sign = la >= 0 ? 1 : -1;
  const col = ((Math.round(lo) % GRID_W) + GRID_W) % GRID_W;
  for (let abs = 25; abs <= 89; abs++) {
    const row = sign * abs + 90;
    let best = 0;
    for (let d = -MERIDIAN_BAND; d <= MERIDIAN_BAND; d++) best = Math.max(best, cells[row * GRID_W + ((col + d + GRID_W) % GRID_W)] ?? 0);
    if (best >= EDGE_PCT) return sign * abs;
  }
  return null;
}

// ── Asteroid close approaches ─────────────────────────────────────

const AU_KM = 149_597_870.7;
const LUNAR_AU = 384_400 / AU_KM;
const UNIX_JD_EPOCH = 2_440_587.5;
const CadResponse = z.object({ fields: z.array(z.string()), data: z.array(z.array(z.string().nullable())) });

/** Diameter in km for an absolute magnitude H and geometric albedo p (the standard asteroid size formula). */
const diameterKm = (h: number, albedo: number): number => (1329 / Math.sqrt(albedo)) * 10 ** (-h / 5);

/** "01:00" or "3_04:00" (days_hours:minutes) to minutes; "< 00:01" and anything else to null. */
function sigmaMinutes(raw: string | null): number | null {
  const m = raw ? /^(?:(\d+)_)?(\d{1,2}):(\d{2})$/.exec(raw) : null;
  if (!m) return null;
  const minutes = Number(m[1] ?? 0) * 1440 + Number(m[2]) * 60 + Number(m[3]);
  return minutes > 0 ? minutes : null;
}

async function loadAsteroids(): Promise<AsteroidsInfo> {
  const url = `${JPL}/cad.api?dist-max=0.05&date-min=now&date-max=%2B30&sort=date&diameter=true&fullname=true`;
  const res = await fetchJson("NASA/JPL close approaches", url, CadResponse);
  const col = (name: string): number => {
    const i = res.fields.indexOf(name);
    if (i < 0) throw new HttpError(502, "upstream_shape", `NASA/JPL close approaches sent no "${name}" column`);
    return i;
  };
  const [cJd, cDist, cV, cH, cDiam, cName, cSigma] = [col("jd"), col("dist"), col("v_rel"), col("h"), col("diameter"), col("fullname"), col("t_sigma_f")];
  const now = Date.now();
  const approaches: Approach[] = [];
  for (const row of res.data) {
    const at = (Number(row[cJd]) - UNIX_JD_EPOCH) * 86_400_000;
    const distAu = Number(row[cDist]);
    if (!Number.isFinite(at) || !Number.isFinite(distAu) || at < now) continue;
    const h = row[cH] === null || row[cH] === undefined ? null : Number(row[cH]);
    const measured = row[cDiam] === null || row[cDiam] === undefined ? null : Number(row[cDiam]);
    approaches.push({
      name: (row[cName] ?? "").trim().replace(/^\((.*)\)$/, "$1"),
      at,
      timeSigmaMin: sigmaMinutes(row[cSigma] ?? null),
      distAu,
      distKm: distAu * AU_KM,
      distLd: distAu / LUNAR_AU,
      velKmS: Number(row[cV]),
      h,
      sizeM:
        measured !== null && Number.isFinite(measured)
          ? { min: measured * 1000, max: measured * 1000, measured: true }
          : h !== null && Number.isFinite(h)
            ? { min: diameterKm(h, 0.25) * 1000, max: diameterKm(h, 0.05) * 1000, measured: false }
            : null,
    });
  }
  return { fetchedAt: now, approaches };
}

// ── Fireballs ─────────────────────────────────────────────────────

const FireballResponse = z.object({ fields: z.array(z.string()), data: z.array(z.array(z.string().nullable())) });

const StoredFireballs = z.array(
  z.object({ id: z.string(), at: z.number(), lat: z.number(), lon: z.number(), kt: z.number(), radiatedJ: z.number(), altKm: z.number().nullable(), velKmS: z.number().nullable() }),
);

async function loadFireballs(): Promise<Fireball[]> {
  const res = await fetchJson("NASA/JPL fireballs", `${JPL}/fireball.api?req-loc=true`, FireballResponse, { timeoutMs: 20_000 });
  const col = (name: string): number => {
    const i = res.fields.indexOf(name);
    if (i < 0) throw new HttpError(502, "upstream_shape", `NASA/JPL fireballs sent no "${name}" column`);
    return i;
  };
  const [cDate, cEnergy, cImpact, cLat, cLatDir, cLon, cLonDir, cAlt, cVel] = [col("date"), col("energy"), col("impact-e"), col("lat"), col("lat-dir"), col("lon"), col("lon-dir"), col("alt"), col("vel")];
  const num = (v: string | null | undefined): number | null => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
  const out: Fireball[] = [];
  for (const row of res.data) {
    const date = row[cDate];
    const la = num(row[cLat]);
    const lo = num(row[cLon]);
    const kt = num(row[cImpact]);
    const radiated = num(row[cEnergy]);
    if (!date || la === null || lo === null || kt === null || radiated === null) continue;
    const at = Date.parse(`${date.replace(" ", "T")}Z`);
    if (!Number.isFinite(at)) continue;
    out.push({
      id: new Date(at).toISOString(),
      at,
      lat: row[cLatDir] === "S" ? -la : la,
      lon: row[cLonDir] === "W" ? -lo : lo,
      kt,
      // The API reports radiated energy in units of 10^10 joules.
      radiatedJ: radiated * 1e10,
      altKm: num(row[cAlt]),
      velKmS: num(row[cVel]),
    });
  }
  if (res.data.length > 0 && out.length === 0) throw new HttpError(502, "upstream_shape", "NASA/JPL fireballs sent rows VANTAGE could not read");
  return out.sort((a, b) => b.at - a.at);
}

export default defineSource({
  probes: [
    { name: "Space weather · NOAA SWPC", url: `${SWPC}/json/planetary_k_index_1m.json` },
    { name: "Asteroids · NASA/JPL", url: `${JPL}/cad.api?dist-max=0.001&date-min=now&date-max=%2B1` },
    { name: "Ionosphere · GIRO via prop.kc2g.com", url: "https://prop.kc2g.com/api/stations.json" },
  ],
  routes: {
    "GET /now": async () => {
      const [kp, wind, xray] = await Promise.all([
        section(() => memo("spacewx:kp", 2 * MIN, loadKp, HOUR)),
        section(() => memo("spacewx:wind", 2 * MIN, loadWind, HOUR)),
        section(() => memo("spacewx:xray", 2 * MIN, loadXray, HOUR)),
      ]);
      return json({ fetchedAt: Date.now(), kp, wind, xray } satisfies SpaceWeatherNow);
    },

    "GET /aurora": async (req) => {
      const q = parseQuery(req, z.object({ lat, lon }));
      const a = await aurora();
      const edgeLat = ovalEdge(a.cells, q.lat, q.lon);
      const reachLat = edgeLat === null ? null : Math.sign(edgeLat) * Math.max(0, Math.abs(edgeLat) - HORIZON_REACH_DEG);
      return json({ observedAt: a.observedAt, forecastAt: a.forecastAt, chancePct: Math.round(chanceAt(a.cells, q.lat, q.lon)), peakPct: Math.max(...a.cells), edgeLat, reachLat } satisfies AuroraPoint);
    },

    "GET /aurora/grid": async () => {
      const a = await aurora();
      return json({ observedAt: a.observedAt, forecastAt: a.forecastAt, width: GRID_W, height: GRID_H, cells: Buffer.from(a.cells).toString("base64") } satisfies AuroraGrid);
    },

    "GET /shields": async (req) => {
      const q = parseQuery(req, z.object({ lat, lon }));
      const [cosmic, field, sky] = await Promise.all([section(loadCosmicRays), section(() => loadField(q)), section(() => loadIonosphere(q))]);
      return json({ fetchedAt: Date.now(), cosmic, field, sky } satisfies Shields);
    },

    "GET /asteroids": async () => json(await memo("spacewx:asteroids", HOUR, loadAsteroids, 6 * HOUR)),

    "GET /fireballs": async () => json(await diskMemo("spacewx-fireballs", 6 * HOUR, loadFireballs, StoredFireballs), { maxAge: 1800 }),
  },
});
