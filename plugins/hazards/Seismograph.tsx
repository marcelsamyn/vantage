import { useEffect, useRef, useState, type ReactElement } from "react";
import { useAmbientMotion, useAnimationFrame, useInterval, usePrefersReducedMotion } from "../../app/core/hooks";
import { MAP_INK } from "../city/extension";
import type { SeismoTrace } from "./types";

const STEP_MS = 60_000;
/** Time constant of the vertical scale's ease toward a new reading. */
const EASE_S = 0.25;
/** Ten minutes of paper move about a pixel a second, so the live paper redraws once a second, or every 30 s at rest. */
const SCROLL_MS = 1000;
const REST_SCROLL_MS = 30_000;

/**
 * Draws a seismograph on a canvas: one vertical stroke per time bin from the lowest to the highest ground velocity, with a
 * time grid every minute. In `live` mode the paper scrolls with the clock, so the newest data sits at the right edge and
 * the minutes since the last reading show as a flat line. Otherwise the whole recorded window is drawn once.
 * `markMs` draws a vertical marker, used for the origin time of a quake.
 */
export function Seismograph({ trace, live, height = 88, markMs }: { trace: SeismoTrace; live: boolean; height?: number; markMs?: number }): ReactElement {
  const canvas = useRef<HTMLCanvasElement>(null);
  const reduced = usePrefersReducedMotion();
  const ambient = useAmbientMotion();
  // Kept across new readings so the vertical scale does not jump when fresh data arrives.
  const scale = useRef(0);
  const lastDraw = useRef(0);
  const [easing, setEasing] = useState(false);

  /** Draw the paper; true while the vertical scale is still easing toward the loudest bin. */
  const draw = (): boolean => {
    const el = canvas.current;
    const ctx = el?.getContext("2d");
    if (!el || !ctx) return false;
    const now = performance.now();
    const dt = (now - lastDraw.current) / 1000;
    lastDraw.current = now;
    const dpr = window.devicePixelRatio || 1;
    const w = el.clientWidth;
    const h = el.clientHeight;
    if (el.width !== Math.round(w * dpr) || el.height !== Math.round(h * dpr)) {
      el.width = Math.round(w * dpr);
      el.height = Math.round(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const t = trace;
    const span = t.endMs - t.startMs;
    // Live paper shows the ten minutes up to now; a finished recording shows its own window.
    const right = live ? Date.now() : t.endMs;
    const left = right - span;
    const x = (ms: number): number => ((ms - left) / span) * w;
    const mid = h / 2;

    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(226, 234, 240, 0.07)";
    ctx.beginPath();
    for (let ms = Math.ceil(left / STEP_MS) * STEP_MS; ms <= right; ms += STEP_MS) {
      const px = Math.round(x(ms)) + 0.5;
      ctx.moveTo(px, 0);
      ctx.lineTo(px, h);
    }
    ctx.moveTo(0, mid + 0.5);
    ctx.lineTo(w, mid + 0.5);
    ctx.stroke();

    // The vertical scale eases toward the loudest bin on screen so a quake does not flatten the quiet minutes forever,
    // and a flat trace is not blown up into noise.
    const floor = Math.max(300, t.rmsNmS * 4);
    const target = Math.max(floor, t.peakNmS * 1.1);
    scale.current = scale.current === 0 || reduced ? target : scale.current + (target - scale.current) * (1 - Math.exp(-dt / EASE_S));
    const k = (mid - 6) / scale.current;

    const bins = t.bins;
    const binMs = span / bins.length;
    ctx.strokeStyle = MAP_INK.sodium;
    ctx.lineWidth = Math.max(1, w / bins.length);
    ctx.beginPath();
    for (let i = 0; i < bins.length; i++) {
      const bin = bins[i];
      if (!bin) continue;
      const px = x(t.startMs + (i + 0.5) * binMs);
      if (px < -2 || px > w + 2) continue;
      const y1 = mid - bin[1] * k;
      const y2 = mid - bin[0] * k;
      ctx.moveTo(px, y1);
      ctx.lineTo(px, Math.max(y2, y1 + 1));
    }
    ctx.stroke();

    if (live) {
      // Time not yet covered by data: a flat line that the next reading will replace.
      const end = x(t.endMs);
      if (end < w) {
        ctx.strokeStyle = "rgba(255, 181, 71, 0.35)";
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 4]);
        ctx.beginPath();
        ctx.moveTo(Math.max(0, end), mid + 0.5);
        ctx.lineTo(w, mid + 0.5);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    if (markMs !== undefined && markMs >= left && markMs <= right) {
      const px = Math.round(x(markMs)) + 0.5;
      ctx.strokeStyle = MAP_INK.alarm;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(px, 0);
      ctx.lineTo(px, h);
      ctx.stroke();
    }
    return Math.abs(target - scale.current) > target * 0.005;
  };
  const drawRef = useRef(draw);
  drawRef.current = draw;

  // A new reading redraws at once and eases the scale over the next frames: motion that shows a change in data.
  useEffect(() => {
    lastDraw.current = performance.now();
    setEasing(drawRef.current());
  }, [trace, live, markMs, height, reduced]);
  useAnimationFrame(() => setEasing(drawRef.current()), easing, "data");
  useInterval(() => drawRef.current(), live && !easing ? (ambient ? SCROLL_MS : REST_SCROLL_MS) : null);

  return <canvas ref={canvas} className="hazards-seismo" style={{ height }} role="img" aria-label={`Seismograph of ground motion at ${trace.station.id}, last ten minutes`} />;
}
