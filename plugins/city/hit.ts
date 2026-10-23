/**
 * Forgiving taps: a finger covers far more than a pixel, so a tap on the map takes the nearest clickable thing within
 * a radius, not only what lies under its exact point. Screen points are CSS pixels.
 */

/** Half the side of the box searched around a touch: a 32 px box, about the size of a fingertip. */
export const TOUCH_RADIUS_PX = 16;

export interface Pt {
  x: number;
  y: number;
}

/** A clickable thing near the tap, in screen space: its points, its lines, or the outer rings of its areas. */
export type ScreenShape = { type: "points"; points: readonly Pt[] } | { type: "lines"; lines: readonly (readonly Pt[])[] } | { type: "areas"; rings: readonly (readonly Pt[])[] };

function toSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = dx * dx + dy * dy;
  const t = len === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function insideRing(p: Pt, ring: readonly Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if (!a || !b) continue;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** The distance an area counts for when the tap lies inside it: further than any point or line the tap reached. */
export const INSIDE_AREA_PX = 10_000;

/**
 * How far a tap at `p` is from a shape, in pixels. An area counts only when the tap is inside it, and then as
 * `INSIDE_AREA_PX`: areas are large, so a point or a line near the finger wins over the area around it.
 */
export function tapDistance(p: Pt, shape: ScreenShape): number {
  if (shape.type === "points") return Math.min(Number.POSITIVE_INFINITY, ...shape.points.map((q) => Math.hypot(p.x - q.x, p.y - q.y)));
  if (shape.type === "lines") {
    let best = Number.POSITIVE_INFINITY;
    for (const line of shape.lines) {
      for (let i = 1; i < line.length; i++) {
        const a = line[i - 1];
        const b = line[i];
        if (a && b) best = Math.min(best, toSegment(p, a, b));
      }
      const only = line[0];
      if (line.length === 1 && only) best = Math.min(best, Math.hypot(p.x - only.x, p.y - only.y));
    }
    return best;
  }
  // Holes are ignored: a tap in the hole of a park still means the park more than nothing.
  return shape.rings.some((ring) => insideRing(p, ring)) ? INSIDE_AREA_PX : Number.POSITIVE_INFINITY;
}

/**
 * The distance a rendered feature counts for. A feature the map found under the exact point of a click is hit,
 * whatever its geometry says: a copy of the world drawn beside the first one, or a geometry collection, would
 * otherwise measure as unreachable.
 */
export function featureDistance(p: Pt, shape: ScreenShape, underPointer: boolean): number {
  const d = tapDistance(p, shape);
  return underPointer && !Number.isFinite(d) ? INSIDE_AREA_PX : d;
}

export interface Candidate<T> {
  item: T;
  distance: number;
}

/**
 * The nearest of the things a tap reached, or null when it reached none. Candidates come from the area the tap
 * covers, so only an infinite distance (a tap beside an area) rules one out. On equal distance the first one wins:
 * the one drawn on top.
 */
export function nearestHit<T>(candidates: readonly Candidate<T>[]): T | null {
  let best: Candidate<T> | null = null;
  for (const c of candidates) if (Number.isFinite(c.distance) && (!best || c.distance < best.distance)) best = c;
  return best?.item ?? null;
}
