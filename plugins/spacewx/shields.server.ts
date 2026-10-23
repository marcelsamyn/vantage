import { HttpError, describe, fetchJson, fetchUpstream, memo, z } from "../../server/kit";
import { distanceM, type LatLon } from "../../shared/geo";
import type { BandReach, CosmicRays, FieldInfo, FieldLevel, ForbushDecrease, IonosphereInfo, Ionosonde, RayStation } from "./types";

/**
 * Earth's shields: three layers that sit between the Sun and the ground.
 *   - cosmic rays, counted by NMDB neutron monitors (nmdb.eu);
 *   - the magnetic field, read by INTERMAGNET observatories through BGS (imag-data.bgs.ac.uk);
 *   - the ionosphere, sounded by GIRO ionosondes and relayed by prop.kc2g.com.
 * Each upstream reply is cached as it arrives; every figure on screen is derived from it per request.
 */

const MIN = 60_000;
const HOUR = 3_600_000;

// ── Cosmic rays (NMDB) ────────────────────────────────────────────

const NMDB = "https://www.nmdb.eu/nest/draw_graph.php";

const MONITORS = [
  { code: "ROME", name: "Rome", lat: 41.9, lon: 12.5 },
  { code: "DRBS", name: "Dourbes", lat: 50.1, lon: 4.6 },
] as const;

/** NMDB asks for this acknowledgement wherever its data is shown. The text follows the header of its own data files. */
export const NMDB_ACKNOWLEDGEMENT =
  "We acknowledge the NMDB database (www.nmdb.eu), founded under the European Union's FP7 programme (contract no. 213007), and the PIs of individual neutron monitors at: Rome (SVIRCO Observatory, INAF IFSI-UNIRomaTre, Italy), Dourbes (Royal Meteorological Institute of Belgium, Brussels, Belgium).";

/** Counts are fetched as hourly, pressure- and efficiency-corrected rates, so weather and detector ageing are already removed. */
export const nmdbUrl = (days: number): string => {
  const query: Record<string, string> = {
    wget: "1",
    tabchoice: "revori",
    dtype: "corr_for_efficiency",
    tresolution: "60",
    force: "1",
    yunits: "0",
    date_choice: "last",
    last_days: String(days),
    last_label: "days_label",
    output: "ascii",
  };
  const url = new URL(NMDB);
  for (const [k, v] of Object.entries(query)) url.searchParams.append(k, v);
  for (const m of MONITORS) url.searchParams.append("stations[]", m.code);
  return url.toString();
};

export interface CountRow {
  at: number;
  cps: number;
}

/** Parse NMDB's ";"-separated ascii table into one list of hourly rows per station code. Missing hours are left out. */
export function parseNmdb(text: string): Map<string, CountRow[]> {
  const codes = text
    .split("\n")
    .find((l) => l.trim() !== "" && !l.startsWith("#") && !l.includes(";"))
    ?.trim()
    .split(/\s+/);
  if (!codes || codes.length === 0) throw new HttpError(502, "upstream_shape", "NMDB sent no station header");
  const out = new Map<string, CountRow[]>(codes.map((c) => [c, []]));
  for (const line of text.split("\n")) {
    const m = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2});(.*)$/.exec(line);
    if (!m) continue;
    const at = Date.parse(`${m[1]}T${m[2]}Z`);
    const cells = (m[3] ?? "").split(";");
    if (!Number.isFinite(at) || cells.length !== codes.length) continue;
    cells.forEach((cell, i) => {
      const cps = Number(cell.trim());
      // A blank, "null" or zero cell means the monitor sent nothing that hour.
      if (cell.trim() !== "" && Number.isFinite(cps) && cps > 0) out.get(codes[i] as string)?.push({ at, cps });
    });
  }
  return out;
}

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? (sorted[mid] as number) : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
};

/** Hours of counts averaged before comparing. One hourly count wobbles by about 0.5 %, a three-hour mean by about 0.3 %. */
const SMOOTH_MS = 3 * HOUR;
/** How far back the "level before the drop" is looked for. Rome's daily swing is about 2 %, and it repeats every day. */
const REFERENCE_MS = 48 * HOUR;
/** A drop this deep below the level of the previous two days counts as a Forbush decrease. Recorded quiet weeks never fall further than 2.8 % (the daily swing and noise); the smallest recorded events fell 4.6 %. */
const FORBUSH_MIN_PCT = 3.5;
/** Counts still this far below the old level count as "not recovered". */
const RECOVERED_PCT = 1.5;
/** The other monitor must have fallen at least this far, near the same time, to confirm an event. */
const CONFIRM_MIN_PCT = 2;

interface Smoothed {
  at: number;
  s: number;
}

function smooth(rows: CountRow[]): Smoothed[] {
  const out: Smoothed[] = [];
  rows.forEach((row, i) => {
    let sum = 0;
    let n = 0;
    for (let j = i; j >= 0 && (rows[j] as CountRow).at > row.at - SMOOTH_MS; j--) {
      sum += (rows[j] as CountRow).cps;
      n++;
    }
    if (n >= 2) out.push({ at: row.at, s: sum / n });
  });
  return out;
}

interface Drop {
  /** Index of the lowest smoothed point of the event. */
  low: number;
  /** Highest smoothed level in the two days before it, and when that was. */
  ref: number;
  refAt: number;
  depthPct: number;
}

/** The deepest fall of one monitor below its own level of the previous two days, or null when it never falls. */
function deepestDrop(sm: Smoothed[]): Drop | null {
  let best: Drop | null = null;
  for (let i = 0; i < sm.length; i++) {
    const p = sm[i] as Smoothed;
    let ref = 0;
    let refAt = p.at;
    for (let j = i; j >= 0 && (sm[j] as Smoothed).at > p.at - REFERENCE_MS; j--) {
      if ((sm[j] as Smoothed).s > ref) {
        ref = (sm[j] as Smoothed).s;
        refAt = (sm[j] as Smoothed).at;
      }
    }
    const depthPct = ((ref - p.s) / ref) * 100;
    if (depthPct > (best?.depthPct ?? 0)) best = { low: i, ref, refAt, depthPct };
  }
  return best;
}

/** Fall of a monitor near `around` (within six hours) below its own previous two-day high. */
function dropNear(sm: Smoothed[], around: number): number {
  let deepest = 0;
  sm.forEach((p, i) => {
    if (Math.abs(p.at - around) > 6 * HOUR) return;
    let ref = 0;
    for (let j = i; j >= 0 && (sm[j] as Smoothed).at > p.at - REFERENCE_MS; j--) ref = Math.max(ref, (sm[j] as Smoothed).s);
    deepest = Math.max(deepest, ((ref - p.s) / ref) * 100);
  });
  return deepest;
}

/**
 * Find a Forbush decrease: a fall of at least 3.5 % in three-hour mean counts below the highest level of the
 * previous two days, seen at one monitor and confirmed (2 % or more near the same time) by the other when it reported.
 * Slow daily swings stay under the threshold; a coronal mass ejection sweeping cosmic rays away does not.
 */
export function findForbush(byCode: Map<string, CountRow[]>): ForbushDecrease | null {
  const smoothed = new Map([...byCode].map(([code, rows]) => [code, smooth(rows)] as const));
  let winner: { code: string; drop: Drop; sm: Smoothed[] } | null = null;
  for (const [code, sm] of smoothed) {
    const drop = deepestDrop(sm);
    if (drop && drop.depthPct >= FORBUSH_MIN_PCT && drop.depthPct > (winner?.drop.depthPct ?? 0)) winner = { code, drop, sm };
  }
  if (!winner) return null;
  const { drop, sm } = winner;
  const lowAt = (sm[drop.low] as Smoothed).at;
  for (const [code, other] of smoothed) {
    if (code !== winner.code && other.length >= 24 && dropNear(other, lowAt) < CONFIRM_MIN_PCT) return null;
  }
  const threshold = drop.ref * (1 - RECOVERED_PCT / 100);
  let last = drop.low;
  while (last + 1 < sm.length && (sm[last + 1] as Smoothed).s <= threshold) last++;
  return {
    onsetAt: drop.refAt,
    lowAt,
    depthPct: drop.depthPct,
    code: winner.code as RayStation["code"],
    untilAt: (sm[last] as Smoothed).at,
    ongoing: last === sm.length - 1,
  };
}

/** Build the cosmic-ray payload from NMDB's text reply. */
export function cosmicRaysFrom(text: string): CosmicRays {
  const parsed = parseNmdb(text);
  const stations: RayStation[] = [];
  for (const m of MONITORS) {
    const rows = parsed.get(m.code) ?? [];
    if (rows.length < 24) continue;
    const baselineCps = median(rows.map((r) => r.cps));
    const points = rows.map((r) => ({ at: r.at, pct: (r.cps / baselineCps - 1) * 100 }));
    const newest = rows[rows.length - 1] as CountRow;
    stations.push({ code: m.code, name: m.name, lat: m.lat, lon: m.lon, baselineCps, points, latest: { at: newest.at, cps: newest.cps, pct: (newest.cps / baselineCps - 1) * 100 } });
  }
  if (stations.length === 0) throw new HttpError(502, "upstream_shape", "NMDB sent too few hourly counts for Rome or Dourbes");
  const forbush = findForbush(new Map(stations.map((s) => [s.code, parsed.get(s.code) ?? []] as const)));
  return { stations, forbush, acknowledgement: NMDB_ACKNOWLEDGEMENT };
}

export async function loadCosmicRays(): Promise<CosmicRays> {
  const text = await memo("spacewx:nmdb", 10 * MIN, async () => (await fetchUpstream("NMDB neutron monitors", nmdbUrl(7), { timeoutMs: 25_000 })).text(), 6 * HOUR);
  return cosmicRaysFrom(text);
}

// ── Magnetometers (INTERMAGNET via BGS) ───────────────────────────

const BGS = "https://imag-data.bgs.ac.uk/GIN_V1/GINServices";

/**
 * Observatories that publish within minutes to hours, and the closest Belgian and Italian ones, which at the time of
 * writing publish a day late. A station without data from the last three hours is skipped, so they join in on their own
 * the day they speed up. Chambon-la-Forêt is left out: its institute has licence terms of its own.
 */
export const OBSERVATORIES = [
  { code: "MAB", name: "Manhay", lat: 50.298, lon: 5.682 },
  { code: "DOU", name: "Dourbes", lat: 50.1, lon: 4.6 },
  { code: "DUR", name: "Duronia", lat: 41.65, lon: 14.47 },
  { code: "FUR", name: "Fürstenfeldbruck", lat: 48.17, lon: 11.28 },
  { code: "NGK", name: "Niemegk", lat: 52.07, lon: 12.68 },
  { code: "WNG", name: "Wingst", lat: 53.725, lon: 9.053 },
  { code: "WIC", name: "Conrad Observatory", lat: 47.931, lon: 15.866 },
  { code: "THY", name: "Tihany", lat: 46.9, lon: 17.89 },
  { code: "PAG", name: "Panagjurishte", lat: 42.515, lon: 24.177 },
  { code: "EBR", name: "Ebro", lat: 40.957, lon: 0.333 },
  { code: "SPT", name: "San Pablo-Toledo", lat: 39.55, lon: -4.35 },
] as const;

const BgsReply = z.object({ datetime: z.array(z.string()), X: z.array(z.number().nullable()), Y: z.array(z.number().nullable()) });
export type BgsRaw = z.infer<typeof BgsReply>;

/** Observatories with no sample in this long are treated as offline. */
const FRESH_MS = 3 * HOUR;
const BIN_MS = 5 * MIN;

/**
 * Words for the largest three-hour swing of the horizontal field. The limits follow the K-index scale
 * (K4 starts at 40 nT, K5 at 70 nT, K6 at 120 nT) rather than its lower ones, because the field's daily swing, up to
 * about 35 nT on a quiet day, is not removed here.
 */
export function fieldLevel(range3hNt: number): FieldLevel {
  if (range3hNt >= 120) return "storm";
  if (range3hNt >= 70) return "active";
  if (range3hNt >= 40) return "unsettled";
  return "calm";
}

type FieldReading = Pick<FieldInfo, "at" | "hNt" | "series" | "range3hNt" | "level">;

/** Horizontal field over the last 24 hours as change from the window's median, or null when the observatory has no recent data. */
export function fieldFrom(raw: BgsRaw, now: number): FieldReading | null {
  const minutes: { at: number; h: number }[] = [];
  raw.datetime.forEach((tag, i) => {
    const x = raw.X[i];
    const y = raw.Y[i];
    const at = Date.parse(tag);
    if (x === null || x === undefined || y === null || y === undefined || !Number.isFinite(at)) return;
    minutes.push({ at, h: Math.hypot(x, y) });
  });
  const newest = minutes.at(-1);
  if (!newest || now - newest.at > FRESH_MS) return null;
  const windowed = minutes.filter((m) => m.at > newest.at - 24 * HOUR);
  const bins = new Map<number, number[]>();
  for (const m of windowed) {
    const key = Math.floor(m.at / BIN_MS) * BIN_MS;
    const list = bins.get(key);
    if (list) list.push(m.h);
    else bins.set(key, [m.h]);
  }
  const means = [...bins].sort((a, b) => a[0] - b[0]).map(([at, hs]) => ({ at, h: hs.reduce((a, b) => a + b, 0) / hs.length }));
  if (means.length < 36) return null;
  const middle = median(means.map((m) => m.h));
  const recent = means.filter((m) => m.at > newest.at - 3 * HOUR).map((m) => m.h);
  const range3hNt = Math.max(...recent) - Math.min(...recent);
  return { at: newest.at, hNt: newest.h, series: means.map((m) => ({ at: m.at, dNt: m.h - middle })), range3hNt, level: fieldLevel(range3hNt) };
}

const dayTag = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

async function observatoryRaw(code: string, now: number): Promise<BgsRaw> {
  // Yesterday and today in one reply, so a 24-hour window is always covered.
  const start = dayTag(now - 24 * HOUR);
  const url = `${BGS}?Request=GetData&format=json&testObsys=0&observatoryIagaCode=${code}&dataStartDate=${start}&dataDuration=2&publicationState=Best%20available&samplesPerDay=minute`;
  return memo(`spacewx:bgs:${code}:${start}`, 5 * MIN, () => fetchJson(`INTERMAGNET ${code} via BGS`, url, BgsReply, { timeoutMs: 25_000 }), 3 * HOUR);
}

const kmBetween = (a: LatLon, b: LatLon): number => distanceM(a, b) / 1000;

/** How long an observatory that sent no recent data is left alone. Those that publish a day late would otherwise be downloaded in full on every refresh, only to be discarded. */
const SILENT_PAUSE_MS = HOUR;
const silentUntil = new Map<string, number>();

/** The nearest observatory with data from the last three hours. Nearer ones that were silent or failed are named in `skipped`. */
export async function loadField(at: LatLon, now = Date.now(), read: (code: string, now: number) => Promise<BgsRaw> = observatoryRaw): Promise<FieldInfo> {
  const byDistance = OBSERVATORIES.map((o) => ({ ...o, km: kmBetween(at, o) })).sort((a, b) => a.km - b.km);
  const skipped: string[] = [];
  for (const o of byDistance) {
    if ((silentUntil.get(o.code) ?? 0) > now) {
      skipped.push(o.name);
      continue;
    }
    let reading: FieldReading | null;
    try {
      reading = fieldFrom(await read(o.code, now), now);
    } catch (err) {
      // A farther observatory may still answer, so one failure must not fail the section.
      skipped.push(`${o.name} (${describe(err)})`);
      continue;
    }
    if (!reading) {
      silentUntil.set(o.code, now + SILENT_PAUSE_MS);
      skipped.push(o.name);
      continue;
    }
    return { code: o.code, name: o.name, lat: o.lat, lon: o.lon, distanceKm: o.km, ...reading, skipped };
  }
  throw new HttpError(502, "upstream_empty", `No INTERMAGNET observatory in the list sent data from the last three hours${skipped.length ? ` (${skipped.join(", ")})` : ""}`);
}

// ── Ionosphere (GIRO ionosondes via prop.kc2g.com) ────────────────

const KC2G = "https://prop.kc2g.com/api/stations.json";

const num = z.number().nullable().optional();
const Sounding = z.object({
  station: z.object({ code: z.string(), name: z.string(), latitude: z.string(), longitude: z.string() }),
  time: z.string(),
  fof2: num,
  hmf2: num,
  mufd: num,
  cs: num,
});
export type SoundingRaw = z.infer<typeof Sounding>;

/** A sounding older than this is ignored. KC2G keeps old entries for closed stations, e.g. a second Rome station last heard in 2024. */
const SOUNDING_FRESH_MS = 90 * MIN;
/** Soundings the model rates below this confidence (0 to 100, or -1 when unknown) are ignored. */
const MIN_CONFIDENCE = 40;
/** Beyond this distance the ionosphere above a station says little about the sky above you. */
const MAX_STATION_KM = 1500;
/** The two stations the panel compares when they have reported: Rome and Dourbes. */
const COMPARE = ["RO041", "DB049"];

const lon180 = (lon: number): number => (lon > 180 ? lon - 360 : lon);

export function freshSoundings(rows: SoundingRaw[], at: LatLon, now: number): Ionosonde[] {
  const out: Ionosonde[] = [];
  for (const r of rows) {
    const time = Date.parse(r.time.endsWith("Z") ? r.time : `${r.time}Z`);
    if (!Number.isFinite(time) || now - time > SOUNDING_FRESH_MS || time - now > 10 * MIN) continue;
    if (r.fof2 == null || r.hmf2 == null || r.mufd == null || (r.cs ?? -1) < MIN_CONFIDENCE) continue;
    const place = { lat: Number(r.station.latitude), lon: lon180(Number(r.station.longitude)) };
    if (!Number.isFinite(place.lat) || !Number.isFinite(place.lon)) continue;
    out.push({ code: r.station.code, name: r.station.name.replace(/,.*$/, ""), distanceKm: kmBetween(at, place), at: time, foF2: r.fof2, hmF2: r.hmf2, muf3000: r.mufd });
  }
  return out;
}

const R_KM = 6371;

/** Amateur radio bands, at the centre of the usual allocation. Shortwave broadcasters sit beside them. */
export const BANDS = [
  { name: "80 m", mhz: 3.6 },
  { name: "40 m", mhz: 7.1 },
  { name: "30 m", mhz: 10.12 },
  { name: "20 m", mhz: 14.2 },
  { name: "17 m", mhz: 18.1 },
  { name: "15 m", mhz: 21.2 },
  { name: "12 m", mhz: 24.9 },
  { name: "10 m", mhz: 28.5 },
] as const;

/** The furthest one bounce can land: the ray grazes the ground, so the geometry alone sets the distance. */
export const maxHopKm = (hmF2: number): number => 2 * R_KM * (Math.PI / 2 - Math.asin(R_KM / (R_KM + hmF2)));

/**
 * Where a signal of `mhz` lands after one bounce off the F2 layer, by the secant law: a layer that reflects foF2
 * from straight above reflects a slanted ray at foF2 / cos(angle of incidence). Higher frequencies need a flatter
 * ray, so they skip further out; above the grazing limit they pass through. Absorption by the daytime D layer,
 * which takes the lowest bands by day, is not modelled.
 */
export function bandReach(foF2: number, hmF2: number, mhz: number): BandReach {
  const toKm = maxHopKm(hmF2);
  const name = BANDS.find((b) => b.mhz === mhz)?.name ?? `${mhz} MHz`;
  if (mhz <= foF2) return { name, mhz, state: "near", fromKm: 0, toKm };
  const incidence = Math.acos(foF2 / mhz);
  const cosTakeoff = ((R_KM + hmF2) * Math.sin(incidence)) / R_KM;
  if (cosTakeoff > 1) return { name, mhz, state: "closed", fromKm: 0, toKm };
  const fromKm = 2 * R_KM * (Math.PI / 2 - Math.acos(cosTakeoff) - incidence);
  return { name, mhz, state: "skip", fromKm, toKm };
}

export function ionosphereFrom(rows: SoundingRaw[], at: LatLon, now: number): IonosphereInfo {
  const fresh = freshSoundings(rows, at, now);
  const nearest = [...fresh].sort((a, b) => a.distanceKm - b.distanceKm)[0];
  if (!nearest || nearest.distanceKm > MAX_STATION_KM) {
    throw new HttpError(404, "no_station", `No ionosonde within ${MAX_STATION_KM} km of you has reported in the last 90 minutes`);
  }
  const other = fresh.filter((s) => COMPARE.includes(s.code) && s.code !== nearest.code).sort((a, b) => a.distanceKm - b.distanceKm)[0] ?? null;
  return { main: nearest, other, bands: BANDS.map((b) => bandReach(nearest.foF2, nearest.hmF2, b.mhz)) };
}

export async function loadIonosphere(at: LatLon, now = Date.now()): Promise<IonosphereInfo> {
  const rows = await memo("spacewx:kc2g", 5 * MIN, () => fetchJson("KC2G ionosonde list", KC2G, z.array(Sounding), { timeoutMs: 20_000 }), 3 * HOUR);
  return ionosphereFrom(rows, at, now);
}
