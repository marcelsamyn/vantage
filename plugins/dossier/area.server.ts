import type { LatLon } from "../../shared/geo";

/** Coarse boxes that decide which register to ask. A register that has nothing for a spot simply answers empty. */
interface Box {
  south: number;
  north: number;
  west: number;
  east: number;
}

const inBox = (b: Box, p: LatLon): boolean => p.lat >= b.south && p.lat <= b.north && p.lon >= b.west && p.lon <= b.east;

const ITALY: Box = { south: 35.4, north: 47.2, west: 6.5, east: 18.8 };
const ROME: Box = { south: 41.6, north: 42.2, west: 12.2, east: 12.95 };
const FLANDERS: Box = { south: 50.67, north: 51.52, west: 2.52, east: 5.93 };
const BRUSSELS: Box = { south: 50.76, north: 50.92, west: 4.24, east: 4.5 };

export const inItaly = (p: LatLon): boolean => inBox(ITALY, p);
export const inRome = (p: LatLon): boolean => inBox(ROME, p);
export const inFlanders = (p: LatLon): boolean => inBox(FLANDERS, p) && !inBox(BRUSSELS, p);
export const inBrussels = (p: LatLon): boolean => inBox(BRUSSELS, p);

const M_PER_DEG_LAT = 111_320;

/** Degrees of latitude and longitude that span `metres` at this latitude. */
export function degreesFor(metres: number, atLat: number): { lat: number; lon: number } {
  return { lat: metres / M_PER_DEG_LAT, lon: metres / (M_PER_DEG_LAT * Math.cos((atLat * Math.PI) / 180)) };
}

export interface Cell extends Box {
  /** Stable name for caching: the same cell for every point inside it. */
  key: string;
}

/**
 * A fixed grid cell around a point, widened by `marginM`, so that clicks a few metres apart share one upstream query
 * and one cache entry. Every point inside the cell has its whole `marginM` neighbourhood inside the widened box.
 */
/** The widest radius any lookup asks for. Cells are fetched with this margin so lookups of every radius share one cache entry. */
export const LOOKUP_MARGIN_M = 150;

export function cellAround(p: LatLon, marginM: number): Cell {
  const STEP_LAT = 0.003;
  const STEP_LON = 0.004;
  const row = Math.floor(p.lat / STEP_LAT);
  const col = Math.floor(p.lon / STEP_LON);
  const m = degreesFor(marginM, p.lat);
  return {
    south: row * STEP_LAT - m.lat,
    north: (row + 1) * STEP_LAT + m.lat,
    west: col * STEP_LON - m.lon,
    east: (col + 1) * STEP_LON + m.lon,
    key: `${row}_${col}_${Math.round(marginM)}`,
  };
}

/** Metres from a point to a polyline or polygon outline, in a local flat projection (good to centimetres at street scale). */
export function distanceToPathM(p: LatLon, path: readonly (readonly [number, number])[]): number {
  const kx = M_PER_DEG_LAT * Math.cos((p.lat * Math.PI) / 180);
  const toXY = ([lon, lat]: readonly [number, number]): [number, number] => [(lon - p.lon) * kx, (lat - p.lat) * M_PER_DEG_LAT];
  let best = Number.POSITIVE_INFINITY;
  let prev: [number, number] | null = null;
  for (const vertex of path) {
    const cur = toXY(vertex);
    if (prev) {
      const [ax, ay] = prev;
      const [bx, by] = cur;
      const dx = bx - ax;
      const dy = by - ay;
      const len2 = dx * dx + dy * dy;
      const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2));
      best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
    } else {
      best = Math.min(best, Math.hypot(cur[0], cur[1]));
    }
    prev = cur;
  }
  return best;
}

/** True when the point lies inside the ring (even-odd rule). */
export function insideRing(p: LatLon, ring: readonly (readonly [number, number])[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i] ?? [0, 0];
    const [xj, yj] = ring[j] ?? [0, 0];
    if (yi > p.lat !== yj > p.lat && p.lon < ((xj - xi) * (p.lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
