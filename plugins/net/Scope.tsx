import { useEffect, useRef, type ReactElement } from "react";
import { useAmbientMotion, useAnimationFrame, usePrefersReducedMotion } from "../../app/core/hooks";
import { fmt } from "../../app/core/format";
import { useRates, type RateSample } from "./client";

const WINDOW_MS = 60_000;
/** The newest sample is drawn this far from the right edge, so the trace scrolls at a steady pace between polls. */
const LAG_MS = 1_100;
const PAD = { left: 68, right: 16, top: 14, bottom: 22 };

interface Palette {
  ice: string;
  sodium: string;
  grid: string;
  label: string;
}

function readPalette(el: HTMLElement): Palette {
  const css = getComputedStyle(el);
  const get = (name: string, fallback: string): string => css.getPropertyValue(name).trim() || fallback;
  return { ice: get("--ice", "#82e4ff"), sodium: get("--sodium", "#ffb547"), grid: get("--line", "rgba(226,234,240,0.08)"), label: get("--ash", "#56616d") };
}

/** Round up to 1, 2 or 5 times a power of ten, so the axis labels stay readable. */
function niceCeil(v: number): number {
  const pow = 10 ** Math.floor(Math.log10(v));
  const n = v / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow;
}

function trace(ctx: CanvasRenderingContext2D, pts: readonly (readonly [number, number])[]): void {
  const first = pts[0];
  if (!first) return;
  ctx.moveTo(first[0], first[1]);
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    if (a && b) ctx.quadraticCurveTo(a[0], a[1], (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
  }
  const last = pts[pts.length - 1];
  if (last && pts.length > 1) ctx.lineTo(last[0], last[1]);
}

/** Live throughput oscilloscope: download in ice, upload in sodium, the last 60 seconds. */
export function Scope(): ReactElement {
  const canvas = useRef<HTMLCanvasElement>(null);
  const size = useRef({ w: 0, h: 0, dpr: 1 });
  const palette = useRef<Palette | null>(null);
  const axisMax = useRef(1e6);
  const reduced = usePrefersReducedMotion();
  // The scroll between samples is ambient: at rest, or with reduced motion, the trace steps once per sample.
  const ambient = useAmbientMotion();
  const stepping = reduced || !ambient;
  // Each sample re-renders the scope, which draws a still frame while the loop rests.
  useRates((s) => s.samples);

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    palette.current = readPalette(el);
    const fit = (): void => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const { width, height } = el.getBoundingClientRect();
      size.current = { w: width, h: height, dpr };
      el.width = Math.round(width * dpr);
      el.height = Math.round(height * dpr);
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useAnimationFrame((dt) => {
    const el = canvas.current;
    const colors = palette.current;
    const ctx = el?.getContext("2d");
    if (!el || !ctx || !colors) return;
    const { w, h, dpr } = size.current;
    if (w === 0) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const samples: readonly RateSample[] = useRates.getState().samples;
    const newest = samples[samples.length - 1];
    const now = stepping && newest ? newest.at + LAG_MS : Date.now();
    const from = now - LAG_MS - WINDOW_MS;
    const visible = samples.filter((s) => s.at >= from - 2000);

    const plotW = w - PAD.left - PAD.right;
    const plotH = h - PAD.top - PAD.bottom;
    const x = (at: number): number => PAD.left + ((at - from) / WINDOW_MS) * plotW;

    const peak = visible.reduce((m, s) => Math.max(m, s.down, s.up), 0);
    const target = niceCeil(Math.max(1e6, peak * 1.15));
    axisMax.current = stepping ? target : axisMax.current + (target - axisMax.current) * (1 - Math.exp(-dt * 4));
    const top = axisMax.current;
    const y = (bps: number): number => PAD.top + plotH - (Math.min(bps, top) / top) * plotH;

    // Grid: three horizontal rules with labels, and a vertical rule every 10 s that scrolls with the data.
    ctx.lineWidth = 1;
    ctx.font = "10px 'Plex Mono', ui-monospace, monospace";
    ctx.fillStyle = colors.label;
    ctx.strokeStyle = colors.grid;
    ctx.textBaseline = "middle";
    ctx.textAlign = "right";
    for (const f of [0, 0.5, 1]) {
      const gy = Math.round(PAD.top + plotH - f * plotH) + 0.5;
      ctx.beginPath();
      ctx.moveTo(PAD.left, gy);
      ctx.lineTo(w - PAD.right, gy);
      ctx.stroke();
      ctx.fillText(fmt.bitsPerSecond(top * f), PAD.left - 8, gy);
    }
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    const firstTick = Math.ceil(from / 10_000) * 10_000;
    for (let t = firstTick; t <= now - LAG_MS; t += 10_000) {
      const gx = Math.round(x(t)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(gx, PAD.top);
      ctx.lineTo(gx, PAD.top + plotH);
      ctx.stroke();
      const ago = Math.round((now - LAG_MS - t) / 1000);
      if (ago % 20 === 0) ctx.fillText(ago === 0 ? "now" : `${ago} s`, gx, h - 6);
    }

    if (visible.length < 2) return;
    ctx.save();
    ctx.beginPath();
    ctx.rect(PAD.left, 0, plotW + PAD.right, h);
    ctx.clip();

    const draw = (pick: (s: RateSample) => number, color: string, fillAlpha: number): void => {
      const pts = visible.map((s) => [x(s.at), y(pick(s))] as const);
      const lastPt = pts[pts.length - 1];
      const firstPt = pts[0];
      if (!lastPt || !firstPt) return;
      const fill = ctx.createLinearGradient(0, PAD.top, 0, PAD.top + plotH);
      fill.addColorStop(0, `${color}`);
      fill.addColorStop(1, "transparent");
      ctx.globalAlpha = fillAlpha;
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.moveTo(firstPt[0], PAD.top + plotH);
      ctx.lineTo(firstPt[0], firstPt[1]);
      trace(ctx, pts);
      ctx.lineTo(lastPt[0], PAD.top + plotH);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.lineJoin = "round";
      ctx.shadowColor = color;
      ctx.shadowBlur = reduced ? 0 : 8;
      ctx.beginPath();
      trace(ctx, pts);
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(lastPt[0], lastPt[1], 2.5, 0, Math.PI * 2);
      ctx.fill();
    };
    draw((s) => s.up, colors.sodium, 0.16);
    draw((s) => s.down, colors.ice, 0.22);
    ctx.restore();
    // The trace scrolls about ten pixels a second: 30 frames a second look as smooth as 60 at half the cost.
  }, true, "ambient", 30);

  return <canvas ref={canvas} className="net-scope" role="img" aria-label="Live download and upload throughput for the last 60 seconds" />;
}
