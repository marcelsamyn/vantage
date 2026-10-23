import { useEffect, useRef, useState, type ReactElement } from "react";
import { useAnimationFrame, usePrefersReducedMotion } from "../../app/core/hooks";
import { sfx } from "../../app/core/sound";
import type { SkyTarget, SkyTone } from "./extension";

const SWEEP_MS = 4800;
const HIT_RADIUS = 14;
/** A fingertip covers more of the radar than a mouse pointer, so taps search a wider circle. */
const TOUCH_HIT_RADIUS = 24;

interface Palette {
  ink: Record<SkyTone, string>;
  fog: string;
  ash: string;
  line: string;
  lineStrong: string;
}

function readPalette(el: Element): Palette {
  const css = getComputedStyle(el);
  const v = (name: string): string => css.getPropertyValue(name).trim();
  return {
    ink: { ice: v("--ice"), sodium: v("--sodium"), alarm: v("--alarm"), mint: v("--mint"), bone: v("--bone") },
    fog: v("--fog"),
    ash: v("--ash"),
    line: v("--line"),
    lineStrong: v("--line-strong"),
  };
}

/** Polar projection: zenith at the centre, horizon at the rim, north up, east right (as on a map). */
function project(az: number, el: number, radius: number): [number, number] {
  const r = ((90 - Math.max(-2, el)) / 90) * radius;
  const a = (az * Math.PI) / 180;
  return [r * Math.sin(a), -r * Math.cos(a)];
}

/** Sky disc, elevation rings, azimuth ticks and labels, centred on the origin. */
function drawBackdrop(ctx: CanvasRenderingContext2D, pal: Palette, R: number): void {
  // Sky disc
  const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, R);
  glow.addColorStop(0, "rgba(130,228,255,0.05)");
  glow.addColorStop(1, "rgba(130,228,255,0.01)");
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(0, 0, R, 0, Math.PI * 2);
  ctx.fill();

  // Elevation rings
  ctx.lineWidth = 1;
  for (const el of [60, 30]) {
    ctx.strokeStyle = pal.line;
    ctx.setLineDash([2, 4]);
    ctx.beginPath();
    ctx.arc(0, 0, ((90 - el) / 90) * R, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.strokeStyle = pal.lineStrong;
  ctx.beginPath();
  ctx.arc(0, 0, R, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = pal.line;
  ctx.beginPath();
  ctx.moveTo(0, -R);
  ctx.lineTo(0, R);
  ctx.moveTo(-R, 0);
  ctx.lineTo(R, 0);
  ctx.stroke();

  // Azimuth ticks and labels
  ctx.font = "500 10px 'Plex Mono', monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (let az = 0; az < 360; az += 5) {
    const major = az % 30 === 0;
    const a = (az * Math.PI) / 180;
    const r1 = R + 3;
    const r2 = R + (major ? 10 : 6);
    ctx.strokeStyle = major ? pal.lineStrong : pal.line;
    ctx.beginPath();
    ctx.moveTo(r1 * Math.sin(a), -r1 * Math.cos(a));
    ctx.lineTo(r2 * Math.sin(a), -r2 * Math.cos(a));
    ctx.stroke();
    if (major) {
      const cardinal = ({ 0: "N", 90: "E", 180: "S", 270: "W" } as Record<number, string>)[az];
      ctx.fillStyle = cardinal ? pal.ink.bone : pal.ash;
      ctx.font = cardinal ? "600 12px 'Plex Mono', monospace" : "500 9px 'Plex Mono', monospace";
      ctx.fillText(cardinal ?? String(az), (R + 21) * Math.sin(a), -(R + 21) * Math.cos(a));
    }
  }
  ctx.fillStyle = pal.ash;
  ctx.font = "500 9px 'Plex Mono', monospace";
  ctx.textAlign = "left";
  ctx.fillText("60°", 4, -((90 - 60) / 90) * R - 7);
  ctx.fillText("30°", 4, -((90 - 30) / 90) * R - 7);
  ctx.fillText("HORIZON", 4, -R - 7);
}

/** Paths, blips, reticles and labels, placed greedily so labels never overlap, and you at the zenith. */
function drawTargets(ctx: CanvasRenderingContext2D, pal: Palette, R: number, list: SkyTarget[], sel: string | null, hov: SkyTarget | null): void {
  ctx.lineWidth = 1;
  ctx.setLineDash([]);
  ctx.textBaseline = "middle";
  // Paths: draw only the parts above the horizon, as separate segments.
  for (const t of list) {
    if (!t.path || t.path.length < 2) continue;
    ctx.strokeStyle = pal.ink[t.tone];
    ctx.globalAlpha = t.id === sel ? 0.7 : 0.25;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    let pen = false;
    for (const p of t.path) {
      if (p.el < 0) {
        pen = false;
        continue;
      }
      const [x, y] = project(p.az, p.el, R);
      if (pen) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
      pen = true;
    }
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }

  // Targets: shapes first, then labels placed greedily so they never overlap.
  const placed: [number, number, number, number][] = [];
  const fits = (x: number, y: number, w: number, h: number): boolean => !placed.some(([px, py, pw, ph]) => x < px + pw && x + w > px && y < py + ph && y + h > py);
  const labelled: { t: SkyTarget; x: number; y: number; color: string; emphasised: boolean; rank: number }[] = [];
  for (const t of list) {
    if (t.el < -1) continue;
    const [x, y] = project(t.az, t.el, R);
    const weight = t.weight ?? 0.5;
    const color = pal.ink[t.tone];
    ctx.globalAlpha = Math.min(1, 0.45 + weight * 0.35);
    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    drawShape(ctx, t, x, y, 1 + weight * 0.3);
    ctx.globalAlpha = 1;
    const emphasised = t.id === sel || t.id === hov?.id;
    if (emphasised) drawReticle(ctx, x, y, color);
    if (emphasised || weight > 0.62 || t.shape === "sun" || t.shape === "moon") {
      labelled.push({ t, x, y, color, emphasised, rank: emphasised ? 2 : weight });
    }
  }
  labelled.sort((a, b) => b.rank - a.rank);
  ctx.textAlign = "left";
  for (const { t, x, y, color, emphasised } of labelled) {
    ctx.font = "600 10px 'Plex Mono', monospace";
    const w = Math.max(ctx.measureText(t.label).width, t.detail ? ctx.measureText(t.detail).width * 0.92 : 0) + 4;
    const h = t.detail ? 26 : 14;
    // Near the right rim a label would run off the canvas (the radar is R + 34 px from centre to edge), so it goes left.
    const lx = x + 11 + w > R + 34 ? x - 11 - w : x + 11;
    const ly = y - 13;
    if (!emphasised && !fits(lx, ly, w, h)) continue;
    placed.push([lx, ly, w, h]);
    ctx.fillStyle = emphasised ? color : pal.ink.bone;
    ctx.fillText(t.label, lx, y - 4);
    if (t.detail) {
      ctx.font = "500 9px 'Plex Mono', monospace";
      ctx.fillStyle = pal.fog;
      ctx.fillText(t.detail, lx, y + 8);
    }
  }

  // You, at the zenith
  ctx.strokeStyle = pal.ink.ice;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(-6, 0);
  ctx.lineTo(6, 0);
  ctx.moveTo(0, -6);
  ctx.lineTo(0, 6);
  ctx.stroke();
  ctx.lineWidth = 1;
}

/**
 * The sky radar: every target reported by sky layers, with a rotating sweep that makes blips flare as it passes
 * them. Click a blip to profile it.
 *
 * It is built in layers so that most frames cost almost nothing: the disc and its scale are drawn once per size,
 * the targets once per change, and the sweep is a CSS element that the compositor turns. Only the flares are drawn
 * each frame, at 30 frames a second, reading the sweep's angle from its animation so they stay under it.
 */
export function Radar({ targets, selectedId, onSelect }: { targets: SkyTarget[]; selectedId: string | null; onSelect: (t: SkyTarget) => void }): ReactElement {
  const wrap = useRef<HTMLDivElement>(null);
  const backdrop = useRef<HTMLCanvasElement>(null);
  const plot = useRef<HTMLCanvasElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const sweepEl = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState(0);
  const [hover, setHover] = useState<SkyTarget | null>(null);
  const reduced = usePrefersReducedMotion();
  const lit = useRef(new Map<string, number>());
  const lastSweep = useRef(0);
  const flaring = useRef(false);
  const sweepAnimation = useRef<{ el: HTMLDivElement; animation: Animation | undefined } | null>(null);
  const palette = useRef<Palette | null>(null);
  const R = size / 2 - 34;

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      if (entry) setSize(Math.floor(Math.min(entry.contentRect.width, entry.contentRect.height)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /** A canvas at device resolution with the origin at the radar's centre. */
  const prepare = (c: HTMLCanvasElement | null): CanvasRenderingContext2D | null => {
    if (!c || size === 0) return null;
    const dpr = window.devicePixelRatio || 1;
    if (c.width !== size * dpr) {
      c.width = size * dpr;
      c.height = size * dpr;
    }
    const ctx = c.getContext("2d");
    ctx?.setTransform(dpr, 0, 0, dpr, (size / 2) * dpr, (size / 2) * dpr);
    ctx?.clearRect(-size / 2, -size / 2, size, size);
    return ctx;
  };

  // The disc, rings, ticks and labels, once per size. Canvas text uses a font only once it has loaded, so the
  // labels are drawn again when Plex Mono is in.
  useEffect(() => {
    const draw = (): void => {
      const ctx = prepare(backdrop.current);
      if (!ctx || !backdrop.current) return;
      palette.current = readPalette(backdrop.current);
      drawBackdrop(ctx, palette.current, R);
    };
    draw();
    let alive = true;
    void Promise.all([document.fonts.load("500 10px 'Plex Mono'"), document.fonts.load("600 12px 'Plex Mono'")]).then(() => alive && draw());
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size]);

  // Paths, blips and labels, once per change of targets, hover or selection.
  useEffect(() => {
    const ctx = prepare(plot.current);
    if (!ctx || !palette.current) return;
    drawTargets(ctx, palette.current, R, targets, selectedId, hover);
    // Forget flares of targets that left the sky.
    const ids = new Set(targets.map((t) => t.id));
    for (const id of lit.current.keys()) if (!ids.has(id)) lit.current.delete(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size, targets, selectedId, hover]);

  // The flares, a loop that rests with the motion policy like the sweep's CSS animation.
  useAnimationFrame(
    (_, now) => {
      const c = canvas.current;
      const pal = palette.current;
      // The sweep's CSS animation lives as long as its element; look it up once, not every frame.
      const el = sweepEl.current;
      if (el && sweepAnimation.current?.el !== el) sweepAnimation.current = { el, animation: el.getAnimations()[0] };
      const at = sweepAnimation.current?.animation?.currentTime;
      if (!c || !pal || typeof at !== "number") return;
      const sweep = ((at % SWEEP_MS) / SWEEP_MS) * 360;
      const from = lastSweep.current;
      for (const t of targets) {
        const crossed = from <= sweep ? t.az > from && t.az <= sweep : t.az > from || t.az <= sweep;
        if (crossed) lit.current.set(t.id, now);
      }
      lastSweep.current = sweep;

      const glowing = targets.filter((t) => t.el >= -1 && now - (lit.current.get(t.id) ?? -1e9) < 5500);
      if (glowing.length === 0 && !flaring.current) return;
      flaring.current = glowing.length > 0;
      const ctx = prepare(c);
      if (!ctx) return;
      for (const t of glowing) {
        const flare = Math.exp(-(now - (lit.current.get(t.id) ?? -1e9)) / 1400);
        const [x, y] = project(t.az, t.el, R);
        const color = pal.ink[t.tone];
        ctx.globalAlpha = flare * 0.5;
        ctx.fillStyle = color;
        ctx.strokeStyle = color;
        drawShape(ctx, t, x, y, 1 + flare * 0.35 + (t.weight ?? 0.5) * 0.3);
      }
      ctx.globalAlpha = 1;
    },
    size > 0 && !reduced,
    "ambient",
    30,
  );

  const coarse = useRef(false);
  const hitTest = (clientX: number, clientY: number): SkyTarget | null => {
    const c = canvas.current;
    if (!c) return null;
    const rect = c.getBoundingClientRect();
    const px = clientX - rect.left - size / 2;
    const py = clientY - rect.top - size / 2;
    let best: SkyTarget | null = null;
    let bestD = coarse.current ? TOUCH_HIT_RADIUS : HIT_RADIUS;
    for (const t of targets) {
      if (t.el < -1) continue;
      const [x, y] = project(t.az, t.el, R);
      const d = Math.hypot(px - x, py - y);
      if (d < bestD) {
        bestD = d;
        best = t;
      }
    }
    return best;
  };

  return (
    <div ref={wrap} className="sky-radar">
      <div className="sky-radar__frame" style={{ width: size, height: size }}>
        <canvas ref={backdrop} className="sky-radar__layer" aria-hidden />
        {!reduced && size > 0 && <div ref={sweepEl} className="sky-radar__sweep" style={{ width: R * 2, height: R * 2, animationDuration: `${SWEEP_MS}ms` }} aria-hidden />}
        <canvas ref={plot} className="sky-radar__layer" aria-hidden />
        <canvas
          ref={canvas}
          className="sky-radar__layer"
          style={{ cursor: hover?.entity ? "pointer" : "default" }}
          onPointerDown={(e) => {
            coarse.current = e.pointerType !== "mouse";
          }}
          onMouseMove={(e) => {
            const hit = hitTest(e.clientX, e.clientY);
            if (hit?.id !== hover?.id) {
              if (hit) sfx.hover();
              setHover(hit);
            }
          }}
          onMouseLeave={() => setHover(null)}
          onClick={(e) => {
            const hit = hitTest(e.clientX, e.clientY);
            if (hit) onSelect(hit);
          }}
          role="img"
          aria-label={`Sky radar with ${targets.length} objects above the horizon`}
        />
      </div>
    </div>
  );
}

function drawShape(ctx: CanvasRenderingContext2D, t: SkyTarget, x: number, y: number, scale: number): void {
  ctx.save();
  ctx.translate(x, y);
  switch (t.shape) {
    case "plane": {
      ctx.rotate(((t.headingDeg ?? 0) * Math.PI) / 180);
      ctx.scale(scale, scale);
      ctx.beginPath();
      ctx.moveTo(0, -6);
      ctx.lineTo(4, 5);
      ctx.lineTo(0, 3);
      ctx.lineTo(-4, 5);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case "dot":
      ctx.beginPath();
      ctx.arc(0, 0, 2.2 * scale, 0, Math.PI * 2);
      ctx.fill();
      break;
    case "diamond":
      ctx.scale(scale, scale);
      ctx.beginPath();
      ctx.moveTo(0, -5);
      ctx.lineTo(5, 0);
      ctx.lineTo(0, 5);
      ctx.lineTo(-5, 0);
      ctx.closePath();
      ctx.fill();
      break;
    case "ring":
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(0, 0, 4.5 * scale, 0, Math.PI * 2);
      ctx.stroke();
      break;
    case "sun":
      ctx.beginPath();
      ctx.arc(0, 0, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = 1.4;
      for (let i = 0; i < 8; i++) {
        const a = (i * Math.PI) / 4;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * 9, Math.sin(a) * 9);
        ctx.lineTo(Math.cos(a) * 13, Math.sin(a) * 13);
        ctx.stroke();
      }
      break;
    case "moon":
      ctx.beginPath();
      ctx.arc(0, 0, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalCompositeOperation = "destination-out";
      ctx.beginPath();
      ctx.arc(3.5, -2, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalCompositeOperation = "source-over";
      break;
  }
  ctx.restore();
}

/** Watch Dogs-style lock-on brackets around the selected target. */
function drawReticle(ctx: CanvasRenderingContext2D, x: number, y: number, color: string): void {
  const s = 13;
  const l = 5;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  for (const [sx, sy] of [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ] as const) {
    ctx.moveTo(x + sx * s, y + sy * (s - l));
    ctx.lineTo(x + sx * s, y + sy * s);
    ctx.lineTo(x + sx * (s - l), y + sy * s);
  }
  ctx.stroke();
  ctx.lineWidth = 1;
}
