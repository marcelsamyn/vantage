import { bearingDeg, distanceM, type LatLon } from "../../shared/geo";
import type { Aircraft } from "./types";

/**
 * Loitering: an aircraft that goes round and round over one place. News and police helicopters, survey
 * flights, medical flights and training flights do it; an airliner in a holding pattern does not, because its
 * racetrack is wider than the circle allowed here.
 */

/** Total turning needed, in degrees: one and a half full circles. */
export const LOITER_TURN_DEG = 540;
/** The turning must happen inside this window. */
export const LOITER_WINDOW_MS = 15 * 60_000;
/** The whole path must fit inside a circle this wide. */
export const LOITER_DIAMETER_M = 6000;
/** Aircraft further than this from you are not tracked. */
export const LOITER_RANGE_M = 60_000;
/** Fixes older than this are forgotten. */
export const LOITER_KEEP_MS = 45 * 60_000;

/** Positions closer together than this say nothing about direction; GPS noise would swamp the bearing. */
const MIN_STEP_M = 150;
/** An aircraft that has not been heard for this long has left the area. */
const GONE_MS = 5 * 60_000;

export interface Fix extends LatLon {
  /** When the aircraft was at this position, ms since epoch. */
  at: number;
}

export interface Loiter {
  /** When the aircraft started going round, ms since epoch. */
  since: number;
  /** Time of the newest fix used. */
  until: number;
  minutes: number;
  /** Turning inside the window, in degrees, in the direction it mostly turns. */
  turnDeg: number;
  direction: "clockwise" | "anticlockwise";
  /** Centre and radius of the smallest circle that holds the path. */
  center: LatLon;
  radiusM: number;
  /** The path since it started going round, oldest first. */
  path: Fix[];
}

const wrap180 = (deg: number): number => ((((deg + 180) % 360) + 360) % 360) - 180;

/** Clockwise and anticlockwise turning along a path, in degrees. Steps shorter than MIN_STEP_M are skipped. */
export function turning(path: readonly LatLon[]): { clockwise: number; anticlockwise: number } {
  let clockwise = 0;
  let anticlockwise = 0;
  let anchor = path[0];
  let heading: number | null = null;
  for (const p of path.slice(1)) {
    if (!anchor || distanceM(anchor, p) < MIN_STEP_M) continue;
    const next = bearingDeg(anchor, p);
    if (heading !== null) {
      const turn = wrap180(next - heading);
      if (turn > 0) clockwise += turn;
      else anticlockwise -= turn;
    }
    heading = next;
    anchor = p;
  }
  return { clockwise, anticlockwise };
}

interface Plane {
  x: number;
  y: number;
}
interface Circle extends Plane {
  r: number;
}

const inside = (c: Circle, p: Plane): boolean => Math.hypot(p.x - c.x, p.y - c.y) <= c.r + 1e-6;

function circleFrom2(a: Plane, b: Plane): Circle {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, r: Math.hypot(a.x - b.x, a.y - b.y) / 2 };
}

function circleFrom3(a: Plane, b: Plane, c: Plane): Circle {
  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
  // Three points on one line: the widest pair spans them all.
  if (Math.abs(d) < 1e-9) {
    const pairs = [circleFrom2(a, b), circleFrom2(a, c), circleFrom2(b, c)];
    return pairs.reduce((best, p) => (p.r > best.r ? p : best));
  }
  const a2 = a.x * a.x + a.y * a.y;
  const b2 = b.x * b.x + b.y * b.y;
  const c2 = c.x * c.x + c.y * c.y;
  const x = (a2 * (b.y - c.y) + b2 * (c.y - a.y) + c2 * (a.y - b.y)) / d;
  const y = (a2 * (c.x - b.x) + b2 * (a.x - c.x) + c2 * (b.x - a.x)) / d;
  return { x, y, r: Math.hypot(a.x - x, a.y - y) };
}

/** Smallest circle that holds all points (incremental construction; paths here have a few hundred points at most). */
function enclosingCircle(points: readonly Plane[]): Circle {
  const first = points[0];
  if (!first) return { x: 0, y: 0, r: 0 };
  let c: Circle = { ...first, r: 0 };
  for (let i = 1; i < points.length; i++) {
    const p = points[i] as Plane;
    if (inside(c, p)) continue;
    c = { ...p, r: 0 };
    for (let j = 0; j < i; j++) {
      const q = points[j] as Plane;
      if (inside(c, q)) continue;
      c = circleFrom2(p, q);
      for (let k = 0; k < j; k++) {
        const s = points[k] as Plane;
        if (!inside(c, s)) c = circleFrom3(p, q, s);
      }
    }
  }
  return c;
}

/** The smallest circle that holds the path. Distances are flat-earth metres around the first fix, which is exact enough at this size. */
export function boundingCircle(path: readonly LatLon[]): { center: LatLon; radiusM: number } {
  const origin = path[0];
  if (!origin) return { center: { lat: 0, lon: 0 }, radiusM: 0 };
  const mPerDegLat = 111_320;
  const mPerDegLon = 111_320 * Math.cos((origin.lat * Math.PI) / 180);
  const flat = path.map((p) => ({ x: (p.lon - origin.lon) * mPerDegLon, y: (p.lat - origin.lat) * mPerDegLat }));
  const c = enclosingCircle(flat);
  return { center: { lat: origin.lat + c.y / mPerDegLat, lon: origin.lon + c.x / mPerDegLon }, radiusM: c.r };
}

/**
 * Is the aircraft loitering at `now`? It is when the latest stretch of its path fits inside a circle 6 km wide
 * and turns at least 540 degrees the same way within the last 15 minutes. The stretch reaches back as far as the
 * path still fits the circle, so an aircraft that flew in from far away is caught as soon as it starts going
 * round, and "since" says when that was.
 */
export function detectLoiter(fixes: readonly Fix[], now: number): Loiter | null {
  const recent = fixes.filter((f) => f.at <= now);
  if (recent.length < 8) return null;

  // Fitting the circle is monotone: if a path fits, every later part of it fits too. Binary search finds the longest fit.
  const fits = (from: number): boolean => boundingCircle(recent.slice(from)).radiusM * 2 <= LOITER_DIAMETER_M;
  let lo = 0;
  let hi = recent.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (fits(mid)) hi = mid;
    else lo = mid + 1;
  }
  const path = recent.slice(lo);
  const lastFix = path[path.length - 1] as Fix;
  if (now - lastFix.at > LOITER_WINDOW_MS) return null;

  const turns = turning(path.filter((f) => f.at >= now - LOITER_WINDOW_MS));
  const turnDeg = Math.max(turns.clockwise, turns.anticlockwise);
  if (turnDeg < LOITER_TURN_DEG) return null;

  const first = path[0] as Fix;
  const bound = boundingCircle(path);
  return {
    since: first.at,
    until: lastFix.at,
    minutes: Math.max(1, Math.round((lastFix.at - first.at) / 60_000)),
    turnDeg: Math.round(turnDeg),
    direction: turns.clockwise >= turns.anticlockwise ? "clockwise" : "anticlockwise",
    center: bound.center,
    radiusM: Math.round(bound.radiusM),
    path,
  };
}

// ── Remembering where each aircraft has been ──────────────────────

export type FixHistory = Map<string, Fix[]>;

/**
 * Add the positions of a new poll. Only aircraft that are flying and near you are kept. A fix is added only when
 * the aircraft has really moved, because receivers repeat the last position while they wait for a new one.
 */
export function remember(history: FixHistory, snapshot: { fetchedAt: number; aircraft: readonly Aircraft[] }, here: LatLon): void {
  for (const a of snapshot.aircraft) {
    if (a.onGround || distanceM(here, a) > LOITER_RANGE_M) continue;
    const at = snapshot.fetchedAt - a.posAgeS * 1000;
    const fixes = history.get(a.hex) ?? [];
    const last = fixes[fixes.length - 1];
    if (last && (at <= last.at || (last.lat === a.lat && last.lon === a.lon))) continue;
    fixes.push({ lat: a.lat, lon: a.lon, at });
    history.set(a.hex, fixes);
  }
  for (const [hex, fixes] of history) {
    const newest = fixes[fixes.length - 1];
    if (!newest || snapshot.fetchedAt - newest.at > GONE_MS) {
      history.delete(hex);
      continue;
    }
    const keepFrom = fixes.findIndex((f) => f.at >= snapshot.fetchedAt - LOITER_KEEP_MS);
    if (keepFrom > 0) history.set(hex, fixes.slice(keepFrom));
  }
}
