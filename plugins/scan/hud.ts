import { groupOf } from "./profiles";
import type { Track } from "./tracker";

/** Colours read from the design tokens, because canvas cannot use CSS variables. */
export interface Ink {
  ice: string;
  sodium: string;
  bone: string;
  alarm: string;
  void: string;
}

export function readInk(): Ink {
  const css = getComputedStyle(document.documentElement);
  const get = (name: string): string => css.getPropertyValue(name).trim();
  return { ice: get("--ice"), sodium: get("--sodium"), bone: get("--bone"), alarm: get("--alarm"), void: get("--void") };
}

export const HUD_FONT = '"Plex Mono", ui-monospace, "SF Mono", monospace';

/** Boxes stay "live" this long after their last detection, then fade out. */
export const FADE_AFTER_MS = 700;
export const FADE_MS = 500;
const APPEAR_MS = 240;

export function colorOf(cls: string, ink: Ink): string {
  const group = groupOf(cls);
  if (group === "person") return ink.ice;
  return group === "vehicle" ? ink.sodium : ink.bone;
}

export function labelOf(track: Track): string {
  return `${track.cls.toUpperCase()} ${Math.round(track.score * 100)}%`;
}

export function dwellText(track: Track, now: number): string {
  const s = Math.max(0, Math.floor((now - track.born) / 1000));
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} m ${String(s % 60).padStart(2, "0")} s`;
}

/** Ease each drawn box toward its latest detection. */
export function easeTracks(tracks: readonly Track[], dt: number): void {
  const k = Math.min(1, dt * 14);
  for (const t of tracks) {
    t.shown.x += (t.box.x - t.shown.x) * k;
    t.shown.y += (t.box.y - t.shown.y) * k;
    t.shown.w += (t.box.w - t.shown.w) * k;
    t.shown.h += (t.box.h - t.shown.h) * k;
  }
}

export function visibility(track: Track, now: number, live: boolean): number {
  if (!live) return 1;
  const stale = now - track.lastSeen;
  return stale <= FADE_AFTER_MS ? 1 : Math.max(0, 1 - (stale - FADE_AFTER_MS) / FADE_MS);
}

export interface HudOptions {
  /** Source pixels to canvas pixels. */
  sx: number;
  /** Drawing width in the same units as the boxes, used to keep labels inside the picture. */
  width: number;
  /** Multiplier for line widths and type, so a saved capture keeps the on-screen proportions. */
  unit: number;
  now: number;
  ink: Ink;
  selectedId: number | null;
  /** Live sources fade out boxes that stopped being detected. A still image keeps them. */
  live: boolean;
  /** Play the lock-on animation for new boxes. Off for captures. */
  animate: boolean;
}

export function drawHud(ctx: CanvasRenderingContext2D, tracks: readonly Track[], o: HudOptions): void {
  const { unit } = o;
  ctx.save();
  ctx.font = `500 ${10.5 * unit}px ${HUD_FONT}`;
  ctx.textBaseline = "middle";
  ctx.lineJoin = "miter";
  ctx.lineCap = "butt";

  for (const track of tracks) {
    const vis = visibility(track, o.now, o.live);
    if (vis <= 0) continue;
    const p = o.animate ? Math.min(1, (o.now - track.born) / APPEAR_MS) : 1;
    const ease = 1 - (1 - p) ** 3;
    // Lock-on: the brackets start 1.3x too large and close in on the object.
    const grow = 1.3 - 0.3 * ease;
    const color = colorOf(track.cls, o.ink);
    const selected = track.id === o.selectedId;

    const w = track.shown.w * o.sx * grow;
    const h = track.shown.h * o.sx * grow;
    const x = (track.shown.x + track.shown.w / 2) * o.sx - w / 2;
    const y = (track.shown.y + track.shown.h / 2) * o.sx - h / 2;

    ctx.globalAlpha = ease * vis;
    ctx.fillStyle = color;
    ctx.globalAlpha = ease * vis * (selected ? 0.14 : 0.05);
    ctx.fillRect(x, y, w, h);

    ctx.globalAlpha = ease * vis;
    ctx.strokeStyle = color;
    ctx.lineWidth = (selected ? 2.5 : 2) * unit;
    const arm = Math.max(8 * unit, Math.min(26 * unit, Math.min(w, h) * 0.25));
    ctx.beginPath();
    ctx.moveTo(x, y + arm); ctx.lineTo(x, y); ctx.lineTo(x + arm, y);
    ctx.moveTo(x + w - arm, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + arm);
    ctx.moveTo(x + w, y + h - arm); ctx.lineTo(x + w, y + h); ctx.lineTo(x + w - arm, y + h);
    ctx.moveTo(x + arm, y + h); ctx.lineTo(x, y + h); ctx.lineTo(x, y + h - arm);
    ctx.stroke();

    if (selected) {
      ctx.setLineDash([4 * unit, 4 * unit]);
      ctx.lineWidth = unit;
      ctx.globalAlpha = ease * vis * 0.7;
      ctx.strokeRect(x, y, w, h);
      ctx.setLineDash([]);
    }

    // Label tab above the box (inside it when the box touches the top edge).
    ctx.globalAlpha = ease * vis;
    const text = labelOf(track);
    const tabH = 16 * unit;
    const tabW = ctx.measureText(text).width + 12 * unit;
    const tabX = Math.max(0, Math.min(x, o.width - tabW));
    const tabY = y - tabH >= 0 ? y - tabH : y;
    ctx.fillStyle = color;
    ctx.fillRect(tabX, tabY, tabW, tabH);
    ctx.fillStyle = o.ink.void;
    ctx.fillText(text, tabX + 6 * unit, tabY + tabH / 2 + unit * 0.5);

    // Second line: track number, confidence for people, and how long it has been in view.
    // Small boxes skip it so a crowd stays readable. The selected box always shows it.
    if (!selected && (w < 80 * unit || h < 44 * unit)) continue;
    const detail = [`#${String(track.id).padStart(2, "0")}`, track.cls === "person" ? `${Math.round(track.score * 100)}%` : null, `IN VIEW ${dwellText(track, o.now)}`].filter(Boolean).join(" · ");
    const detailW = ctx.measureText(detail).width + 12 * unit;
    const detailY = y + h + 3 * unit;
    ctx.fillStyle = "rgba(5, 7, 10, 0.72)";
    ctx.fillRect(x, detailY, detailW, 14 * unit);
    ctx.fillStyle = color;
    ctx.fillText(detail, x + 6 * unit, detailY + 7 * unit + unit * 0.5);
  }
  ctx.restore();
}

/** The smallest drawn box under a point given in canvas pixels. */
export function hitTrack(tracks: readonly Track[], px: number, py: number, sx: number, now: number, live: boolean): Track | null {
  let best: Track | null = null;
  let bestArea = Infinity;
  for (const t of tracks) {
    if (visibility(t, now, live) <= 0) continue;
    const { x, y, w, h } = t.shown;
    if (px < x * sx || px > (x + w) * sx || py < y * sx || py > (y + h) * sx) continue;
    const area = w * h;
    if (area < bestArea) {
      best = t;
      bestArea = area;
    }
  }
  return best;
}
