import { HttpError, diskMemo, fetchJson, log, z } from "../../server/kit";
import { LIGHT_KM_S, norm3 } from "./physics";
import type { SystemBody, SystemSnapshot, UnavailableBody } from "./types";

const SOURCE = "JPL Horizons";
const URL_BASE = "https://ssd.jpl.nasa.gov/api/horizons.api";
const USER_AGENT = "VANTAGE/1.0 (personal dashboard; local)";

/** A body's state vector is good for hours: planets move 0.1° and Voyager 1 about 60 000 km in that time. */
const SOLUTION_TTL_MS = 3 * 3_600_000;
/** After a failure, or a "no trajectory" answer, wait before asking again. */
const RETRY_MS = 5 * 60_000;
const NO_TRAJECTORY_TTL_MS = 12 * 3_600_000;
/** Horizons asks clients to send one request at a time; this pause keeps a cold start gentle. */
const SPACING_MS = 350;
/** Barycentric Dynamical Time runs ahead of UTC by 37 leap seconds plus 32.184 s. */
const TDB_MINUS_UTC_S = 69.184;
const UNIX_EPOCH_JD = 2_440_587.5;

export interface Named {
  id: number;
  name: string;
}

export const PLANETS: readonly Named[] = [
  { id: 199, name: "Mercury" },
  { id: 299, name: "Venus" },
  { id: 399, name: "Earth" },
  { id: 499, name: "Mars" },
  { id: 599, name: "Jupiter" },
  { id: 699, name: "Saturn" },
  { id: 799, name: "Uranus" },
  { id: 899, name: "Neptune" },
  { id: 999, name: "Pluto" },
];
export const EARTH_ID = 399;

/** Ids as JPL Horizons lists them; each was checked against Horizons' own "Target body name". */
export const PROBES: readonly Named[] = [
  { id: -31, name: "Voyager 1" },
  { id: -32, name: "Voyager 2" },
  { id: -98, name: "New Horizons" },
  { id: -170, name: "James Webb Space Telescope" },
  { id: -96, name: "Parker Solar Probe" },
  { id: -61, name: "Juno" },
  { id: -159, name: "Europa Clipper" },
  { id: -255, name: "Psyche" },
  { id: -49, name: "Lucy" },
  { id: -121, name: "BepiColombo" },
  { id: -28, name: "Juice" },
  { id: -74, name: "Mars Reconnaissance Orbiter" },
  { id: -53, name: "Mars Odyssey" },
  { id: -144, name: "Solar Orbiter" },
  { id: -91, name: "Hera" },
];

export const nameOfKnown = (id: number): string | undefined => [...PLANETS, ...PROBES].find((b) => b.id === id)?.name;

// ── Talking to Horizons ───────────────────────────────────────────

export interface StateVector {
  kind: "state";
  /** When the solution is valid, in Unix ms. */
  epochMs: number;
  /** km from the Sun, ecliptic J2000. */
  pos: [number, number, number];
  /** km/s. */
  vel: [number, number, number];
}
export interface NoTrajectory {
  kind: "none";
  reason: string;
}
export type Solution = StateVector | NoTrajectory;

const Vector3 = z.tuple([z.number(), z.number(), z.number()]);
const StoredSolution = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("state"), epochMs: z.number(), pos: Vector3, vel: Vector3 }),
  z.object({ kind: z.literal("none"), reason: z.string() }),
]);

const responseSchema = z.object({ result: z.string().optional(), error: z.string().optional() });

const pad = (n: number): string => String(n).padStart(2, "0");
const horizonsTime = (ms: number): string => {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
};

/** The first data row of a Horizons vector table: JD, calendar date, X, Y, Z, VX, VY, VZ. */
export function parseVectorTable(text: string): StateVector | null {
  const row = /\$\$SOE\s*\n([^\n]+)/.exec(text)?.[1];
  if (!row) return null;
  const cells = row.split(",").map((c) => c.trim());
  const [jd, , x, y, z, vx, vy, vz] = cells.map(Number);
  const values = [jd, x, y, z, vx, vy, vz];
  if (values.some((v) => v === undefined || !Number.isFinite(v))) return null;
  return {
    kind: "state",
    epochMs: ((jd as number) - UNIX_EPOCH_JD) * 86_400_000 - TDB_MINUS_UTC_S * 1000,
    pos: [x as number, y as number, z as number],
    vel: [vx as number, vy as number, vz as number],
  };
}

async function fetchSolution(id: number): Promise<Solution> {
  const start = Date.now();
  const url = new URL(URL_BASE);
  const params: Record<string, string> = {
    format: "json",
    COMMAND: `'${id}'`,
    OBJ_DATA: "NO",
    MAKE_EPHEM: "YES",
    EPHEM_TYPE: "VECTORS",
    // The Sun's centre, in the plane of Earth's orbit as it was in the year 2000.
    CENTER: "'500@10'",
    REF_PLANE: "ECLIPTIC",
    START_TIME: `'${horizonsTime(start)}'`,
    STOP_TIME: `'${horizonsTime(start + 60_000)}'`,
    STEP_SIZE: "'1 m'",
    VEC_TABLE: "2",
    OUT_UNITS: "KM-S",
    CSV_FORMAT: "YES",
  };
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const body = await fetchJson(SOURCE, url, responseSchema, { headers: { "user-agent": USER_AGENT } });
  const text = body.result ?? body.error ?? "";
  const state = parseVectorTable(text);
  if (state) return state;
  const refusal = /No ephemeris for target[^\n]*|No such record[^\n]*|No matches found[^\n]*/i.exec(text)?.[0];
  if (refusal) return { kind: "none", reason: refusal.trim() };
  throw new HttpError(502, "upstream_shape", `${SOURCE} sent no vector table for body ${id}`);
}

// ── One request at a time ─────────────────────────────────────────

export type Entry = { state: "ready"; solution: Solution; at: number } | { state: "error"; message: string; at: number };

const entries = new Map<number, Entry>();
const queue: number[] = [];
let pumping = false;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * A state vector is as old as the moment it describes, not as old as this process's read of it: the disk cache
 * may hand back a solution that is already hours old, and that must not count as new.
 */
export function readyEntry(solution: Solution, now: number): Entry {
  return { state: "ready", solution, at: solution.kind === "state" ? solution.epochMs : now };
}

export function isFresh(entry: Entry | undefined, now: number): boolean {
  if (!entry) return false;
  if (entry.state === "error") return now - entry.at < RETRY_MS;
  return now - entry.at < (entry.solution.kind === "none" ? NO_TRAJECTORY_TTL_MS : SOLUTION_TTL_MS);
}

async function pump(): Promise<void> {
  if (pumping) return;
  pumping = true;
  try {
    for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
      let asked = false;
      try {
        const solution = await diskMemo(`deepspace-horizons-${id}`, SOLUTION_TTL_MS, () => {
          asked = true;
          return fetchSolution(id);
        }, StoredSolution);
        entries.set(id, readyEntry(solution, Date.now()));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log.warn("horizons request failed", { id, message });
        entries.set(id, { state: "error", message, at: Date.now() });
      }
      if (asked) await sleep(SPACING_MS);
    }
  } finally {
    pumping = false;
  }
}

/** Ask for these bodies to be loaded, most important first. `urgent` jumps the queue. */
export function want(ids: readonly number[], urgent = false): void {
  const now = Date.now();
  const missing = ids.filter((id) => !isFresh(entries.get(id), now) && !queue.includes(id));
  if (missing.length === 0) return;
  if (urgent) queue.unshift(...missing);
  else queue.push(...missing);
  void pump();
}

/** Resolves when `id` has an answer, or after `timeoutMs`. */
export async function settle(id: number, timeoutMs: number): Promise<void> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const entry = entries.get(id);
    if (entry && !queue.includes(id)) return;
    await sleep(80);
  }
}

// ── Reading what has been loaded ──────────────────────────────────

const project = (v: StateVector, at: number): [number, number, number] => {
  const dt = (at - v.epochMs) / 1000;
  return [v.pos[0] + v.vel[0] * dt, v.pos[1] + v.vel[1] * dt, v.pos[2] + v.vel[2] * dt];
};

/** Position, distances and speeds of one body at `at`, projected along its velocity from the JPL solution. */
export function describeBody(named: Named, kind: SystemBody["kind"], v: StateVector, earth: StateVector, at: number): SystemBody {
  const pos = project(v, at);
  const e = project(earth, at);
  const distSunKm = norm3(pos);
  const distEarthKm = norm3([pos[0] - e[0], pos[1] - e[1], pos[2] - e[2]]);
  return {
    id: named.id,
    name: named.name,
    kind,
    pos,
    distSunKm,
    distEarthKm,
    speedKmS: norm3(v.vel),
    radialKmS: distSunKm === 0 ? 0 : (pos[0] * v.vel[0] + pos[1] * v.vel[1] + pos[2] * v.vel[2]) / distSunKm,
    lightSeconds: distEarthKm / LIGHT_KM_S,
    epochMs: v.epochMs,
  };
}

function stateOf(id: number): StateVector | null {
  const entry = entries.get(id);
  return entry?.state === "ready" && entry.solution.kind === "state" ? entry.solution : null;
}

/** Distance from Earth in km for a spacecraft that has been loaded, else null. Never waits. */
export function earthDistanceKm(id: number, at = Date.now()): number | null {
  const earth = stateOf(EARTH_ID);
  const v = stateOf(id);
  return earth && v ? describeBody({ id, name: "" }, "probe", v, earth, at).distEarthKm : null;
}

/** One body as it stands now, or null while Earth or the body is not loaded. */
export function loadedBody(named: Named, kind: SystemBody["kind"], at = Date.now()): SystemBody | null {
  const earth = stateOf(EARTH_ID);
  const v = stateOf(named.id);
  return earth && v ? describeBody(named, kind, v, earth, at) : null;
}

/** Every planet and probe loaded so far. `extras` adds spacecraft the network is tracking that our own list lacks. */
export function snapshot(extras: readonly Named[], at = Date.now()): SystemSnapshot {
  const bodies: SystemBody[] = [];
  const unavailable: UnavailableBody[] = [];
  let pending = 0;
  const probes = [...PROBES, ...extras.filter((e) => !PROBES.some((p) => p.id === e.id))];
  const wanted = [...PLANETS.map((p) => [p, "planet"] as const), ...probes.map((p) => [p, "probe"] as const)];
  for (const [named, kind] of wanted) {
    const entry = entries.get(named.id);
    if (entry?.state === "error") unavailable.push({ id: named.id, name: named.name, reason: entry.message });
    else if (entry?.solution.kind === "none") unavailable.push({ id: named.id, name: named.name, reason: entry.solution.reason });
    else {
      const body = loadedBody(named, kind, at);
      if (body) bodies.push(body);
      else pending += 1;
    }
  }
  return { at, bodies, pending, unavailable };
}

/** The reason JPL has no trajectory for `id`, or null when it has one or has not answered yet. */
export function refusalFor(id: number): string | null {
  const entry = entries.get(id);
  if (entry?.state === "ready" && entry.solution.kind === "none") return entry.solution.reason;
  if (entry?.state === "error") return entry.message;
  return null;
}
