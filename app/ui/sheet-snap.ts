/**
 * Pure geometry for bottom sheets: where each snap point rests, where a released sheet settles, and what the handle
 * does next. Offsets are in CSS pixels from the panel's highest position, growing downward.
 */

/** "peek": the header and a row, so the screen behind gets most of the room. "half": half the room. "full": all of it. */
export type SnapPoint = "peek" | "half" | "full";

const ORDER: readonly SnapPoint[] = ["peek", "half", "full"];

/** Sort snap points from lowest to highest. */
export const bySize = (snaps: readonly SnapPoint[]): SnapPoint[] => ORDER.filter((s) => snaps.includes(s));

export interface SheetMetrics {
  /** The panel's height. */
  height: number;
  /** The height the sheet may cover, from its top bound to its bottom bound. */
  room: number;
  /** How much a peeking sheet shows: its header and the start of its content. */
  peek: number;
}

/** How far the panel moves down from its highest position to rest at `snap`. Never negative, never past the panel. */
export function snapOffset(snap: SnapPoint, m: SheetMetrics): number {
  const shown = snap === "full" ? m.height : snap === "half" ? m.room / 2 : m.peek;
  return Math.round(Math.max(0, m.height - Math.min(m.height, shown)));
}

/** A release faster than this, in px/ms, is a flick: the sheet moves on to the next stop in that direction. */
export const FLICK_PX_PER_MS = 0.45;

export interface Stop<S extends string> {
  id: S;
  y: number;
}

/**
 * Where a sheet released at offset `y` with `velocity` (px/ms, positive downward) settles. A flick goes to the next
 * stop in its direction, so a short quick swipe still moves the sheet; a slow release goes to the nearest stop.
 */
export function settleAt<S extends string>(stops: readonly Stop<S>[], y: number, velocity: number): S {
  const first = stops[0];
  if (!first) throw new Error("A sheet needs at least one stop");
  if (Math.abs(velocity) >= FLICK_PX_PER_MS) {
    const down = velocity > 0;
    const ahead = stops.filter((s) => (down ? s.y > y : s.y < y)).sort((a, b) => (down ? a.y - b.y : b.y - a.y))[0];
    if (ahead) return ahead.id;
  }
  return stops.reduce((best, s) => (Math.abs(s.y - y) < Math.abs(best.y - y) ? s : best), first).id;
}

/** The handle's next snap point: one size up, and from the largest back to the smallest. */
export function nextSnap(snaps: readonly SnapPoint[], current: SnapPoint): SnapPoint {
  const sorted = bySize(snaps);
  const i = sorted.indexOf(current);
  return sorted[(i + 1) % sorted.length] ?? current;
}

/** Past an end stop, a drag moves the sheet a quarter as far, so it resists instead of detaching. */
export function resist(y: number, min: number, max: number): number {
  if (y < min) return min - (min - y) / 4;
  if (y > max) return max + (y - max) / 4;
  return y;
}
