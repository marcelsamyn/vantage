/**
 * Pure geometry for the "Around me" mode: the search radius at a zoom, and edge pips that point at things off screen.
 * Screen points are in CSS pixels, with y growing downward.
 */

/** The zoom "Around me" opens at: a walking scale. */
export const AROUND_ZOOM = 16;
const RADIUS_AT_AROUND_ZOOM_M = 1000;
const MIN_STEPS = 0; // Keep the opening search area when looking closer.
const MAX_STEPS = 3; // 8 km

/** The search radius follows the zoom in powers of two: 1 km at the opening zoom or closer, 2 km one level out. */
export function radiusForZoom(zoom: number): number {
  const steps = Math.min(MAX_STEPS, Math.max(MIN_STEPS, Math.round(AROUND_ZOOM - zoom)));
  return RADIUS_AT_AROUND_ZOOM_M * 2 ** steps;
}

/** The radius one zoom level out, or null at the widest. */
export function widerRadius(radiusM: number): number | null {
  return radiusM < RADIUS_AT_AROUND_ZOOM_M * 2 ** MAX_STEPS ? radiusM * 2 : null;
}

export interface Pt {
  x: number;
  y: number;
}

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export type Side = "top" | "right" | "bottom" | "left";

export const inside = (p: Pt, r: Rect): boolean => p.x >= r.left && p.x <= r.right && p.y >= r.top && p.y <= r.bottom;
export const centre = (r: Rect): Pt => ({ x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2 });

export interface EdgePoint extends Pt {
  side: Side;
  /** Screen direction from the anchor to the target, in degrees clockwise from pointing right. */
  angle: number;
}

/** Where the line from `anchor` (inside `rect`) toward `target` leaves the rectangle. */
export function edgePoint(anchor: Pt, target: Pt, rect: Rect): EdgePoint {
  const dx = target.x - anchor.x;
  const dy = target.y - anchor.y;
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
  let best: { t: number; side: Side } = { t: Number.POSITIVE_INFINITY, side: "top" };
  const consider = (t: number, side: Side): void => {
    if (t >= 0 && t < best.t) best = { t, side };
  };
  if (dx > 0) consider((rect.right - anchor.x) / dx, "right");
  if (dx < 0) consider((rect.left - anchor.x) / dx, "left");
  if (dy > 0) consider((rect.bottom - anchor.y) / dy, "bottom");
  if (dy < 0) consider((rect.top - anchor.y) / dy, "top");
  if (!Number.isFinite(best.t)) return { ...anchor, side: "top", angle };
  return { x: anchor.x + dx * best.t, y: anchor.y + dy * best.t, side: best.side, angle };
}

/** Distance along the rectangle's edge, clockwise from its top-left corner. */
export function perimeterOf(p: Pt & { side: Side }, r: Rect): number {
  const w = r.right - r.left;
  const h = r.bottom - r.top;
  if (p.side === "top") return p.x - r.left;
  if (p.side === "right") return w + (p.y - r.top);
  if (p.side === "bottom") return w + h + (r.right - p.x);
  return 2 * w + h + (r.bottom - p.y);
}

/** The point on the rectangle's edge at a distance `s` clockwise from its top-left corner. */
export function pointAtPerimeter(s: number, r: Rect): Pt & { side: Side } {
  const w = r.right - r.left;
  const h = r.bottom - r.top;
  const total = 2 * (w + h);
  const t = ((s % total) + total) % total;
  if (t < w) return { x: r.left + t, y: r.top, side: "top" };
  if (t < w + h) return { x: r.right, y: r.top + (t - w), side: "right" };
  if (t < 2 * w + h) return { x: r.right - (t - w - h), y: r.bottom, side: "bottom" };
  return { x: r.left, y: r.bottom - (t - 2 * w - h), side: "left" };
}

export interface PipInput {
  key: string;
  /** Where the thing projects on screen; off the rectangle, or it would be drawn where it is. */
  target: Pt;
  distanceM: number;
}

export interface Pip extends Pt {
  side: Side;
  /** Screen direction toward the pip's first member, for its arrow. */
  angle: number;
  /** The things this pip stands for, nearest first (a chosen `lead` goes first). Its key is the first member's. */
  members: string[];
}

/** A pip's footprint on screen, with room around it; pips whose footprints would meet merge. */
export interface PipSize {
  w: number;
  h: number;
}

interface Group {
  members: (PipInput & EdgePoint & { s: number })[];
  s: number;
}

/**
 * Pip footprints, with a little air. On the top and bottom edges a pip is a capsule (84 × 26 in city.css), on the
 * left and right a narrow tag (46 × 40), so side pips take little of a phone's width.
 */
export const PIP_CAPSULE: PipSize = { w: 90, h: 32 };
export const PIP_TAG: PipSize = { w: 52, h: 46 };
export const pipSize = (side: Side): PipSize => (side === "top" || side === "bottom" ? PIP_CAPSULE : PIP_TAG);

/** Where things are drawn as markers: the frame without the band its pips run in, so no marker sits under a pip. */
export const markArea = (frame: Rect): Rect => ({ left: frame.left + PIP_TAG.w, top: frame.top + PIP_CAPSULE.h, right: frame.right - PIP_TAG.w, bottom: frame.bottom - PIP_CAPSULE.h });

/** The line pip centres run along: each side of `frame` moved in by half the depth of the pips on that side. */
export function pipTrack(frame: Rect, size: (side: Side) => PipSize): Rect {
  return { left: frame.left + size("left").w / 2, right: frame.right - size("right").w / 2, top: frame.top + size("top").h / 2, bottom: frame.bottom - size("bottom").h / 2 };
}

/**
 * Edge pips for things off screen, inside `frame` (the map area no panel covers). Each pip sits where the line from
 * `anchor` toward its thing meets the pip track, and stays whole inside the frame, also near a corner. Pips whose
 * footprints would meet merge into one at their members' mean place along the edge, so a crowded edge shows one pip
 * with a count instead of a pile. A pip's size may depend on its side. `lead` (the selection) heads its pip.
 */
export function layoutPips(inputs: readonly PipInput[], anchor: Pt, frame: Rect, size: (side: Side) => PipSize, lead: string | null = null): Pip[] {
  if (inputs.length === 0) return [];
  const rect = pipTrack(frame, size);
  const from = inside(anchor, rect) ? anchor : centre(rect);
  const total = 2 * (rect.right - rect.left + rect.bottom - rect.top);
  const points = inputs.map((input) => {
    const edge = edgePoint(from, input.target, rect);
    return { ...input, ...edge, s: perimeterOf(edge, rect) };
  });
  points.sort((a, b) => a.s - b.s);

  const clamp = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), Math.max(lo, hi));
  const position = (g: Group): Pt & { side: Side } => {
    const p = pointAtPerimeter(g.s, rect);
    const { w, h } = size(p.side);
    return p.side === "top" || p.side === "bottom" ? { ...p, x: clamp(p.x, frame.left + w / 2, frame.right - w / 2) } : { ...p, y: clamp(p.y, frame.top + h / 2, frame.bottom - h / 2) };
  };
  const overlaps = (a: Pt & { side: Side }, b: Pt & { side: Side }): boolean => {
    const sa = size(a.side);
    const sb = size(b.side);
    return Math.abs(a.x - b.x) < (sa.w + sb.w) / 2 && Math.abs(a.y - b.y) < (sa.h + sb.h) / 2;
  };
  // One lap back, for the group on the far side of the top-left corner.
  const lapBack = (g: Group): Group => ({ members: g.members.map((m) => ({ ...m, s: m.s - total })), s: g.s - total });
  // A group sits at its members' mean distance along the edge, measured the short way round the corner.
  const merge = (a: Group, b: Group): Group => {
    const [lo, hi] = a.s <= b.s ? [a, b] : [b, a];
    const near = hi.s - lo.s > total / 2 ? [lapBack(hi), lo] : [lo, hi];
    const members = near.flatMap((g) => g.members);
    return { members, s: members.reduce((acc, m) => acc + m.s, 0) / members.length };
  };

  let groups: Group[] = points.map((p) => ({ members: [p], s: p.s }));
  // Merging moves a group, which can make it meet its neighbour: repeat until nothing changes.
  for (let changed = true; changed && groups.length > 1; ) {
    changed = false;
    const next: Group[] = [];
    for (const g of groups) {
      const last = next[next.length - 1];
      if (last && overlaps(position(last), position(g))) {
        next[next.length - 1] = merge(last, g);
        changed = true;
      } else next.push(g);
    }
    const first = next[0];
    const lastGroup = next[next.length - 1];
    if (next.length > 1 && first && lastGroup && overlaps(position(lastGroup), position(first))) {
      next.splice(next.length - 1, 1);
      next[0] = merge(lastGroup, first);
      changed = true;
    }
    groups = next;
  }

  return groups.map((g) => {
    const members = [...g.members].sort((a, b) => (a.key === lead ? -1 : b.key === lead ? 1 : a.distanceM - b.distanceM));
    const head = members[0] ?? g.members[0];
    const at = position(g);
    return { x: at.x, y: at.y, side: at.side, angle: head?.angle ?? 0, members: members.map((m) => m.key) };
  });
}

const COMPASS_WORDS = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"] as const;

/** "north-east": the eight-point compass direction of a bearing, in words for labels read aloud. */
export function compassWords(bearing: number): string {
  return COMPASS_WORDS[Math.round((((bearing % 360) + 360) % 360) / 45) % 8] ?? "north";
}

/**
 * A key for each pip that survives merges and splits: the focused member's pip keeps its key, then any member whose
 * key a pip had last time, then the first member. React then keeps the button, and keyboard focus stays on it.
 */
export function stablePipKeys(pips: readonly { members: readonly string[] }[], previous: readonly string[], focused: string | null): string[] {
  const before = new Set(previous);
  const taken = new Set<string>();
  const holdsFocus = (i: number): boolean => focused !== null && (pips[i]?.members.includes(focused) ?? false);
  // The pip holding the focused key chooses first, so no other pip can take it.
  const order = pips.map((_, i) => i).sort((a, b) => Number(holdsFocus(b)) - Number(holdsFocus(a)));
  const keys: string[] = [];
  for (const i of order) {
    const free = (pips[i]?.members ?? []).filter((m) => !taken.has(m));
    const key = (focused !== null && free.includes(focused) ? focused : undefined) ?? free.find((m) => before.has(m)) ?? free[0] ?? `pip-${i}`;
    taken.add(key);
    keys[i] = key;
  }
  return keys;
}
