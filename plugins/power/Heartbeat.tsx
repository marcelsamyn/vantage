import { useEffect, useRef, useState, type ReactElement } from "react";
import { fmt } from "../../app/core/format";
import { useAmbientMotion, useAnimationFrame, usePrefersReducedMotion, useStoredState } from "../../app/core/hooks";
import { Empty, LiveDot, Scanning, Segmented, Tag } from "../../app/ui";
import { MAP_INK } from "../city/extension";
import { describeFrequency, frequencyAt, useFrequencyStore } from "./client";

/**
 * The grid's heartbeat: the frequency of the whole continental European grid as an oscilloscope trace.
 *
 * Readings are one per second and arrive in bursts a few minutes late. The trace replays them at the
 * speed of real time from a point a little behind the newest reading, and draws the head between two
 * readings, so it flows instead of jumping when a batch arrives.
 */

const WINDOWS = [
  { value: "300", label: "5 min" },
  { value: "1800", label: "30 min" },
  { value: "3600", label: "1 h" },
] as const;

const RANGES = [
  { value: "250", label: "±250 mHz" },
  { value: "100", label: "±100 mHz" },
] as const;

/** Reserve the replay keeps between its head and the newest reading, so a late batch never starves it. */
const LEAD_S = 45;
const LEAD_MIN_S = 15;
const LEAD_MAX_S = 100;

const PAD = { left: 50, right: 18, top: 14, bottom: 26 };

/** Grid-line spacing in seconds for each window. */
const GRID_S: Record<number, number> = { 300: 60, 1800: 300, 3600: 600 };

interface Reading {
  hz: number;
  at: number;
}

export default function Heartbeat(): ReactElement {
  const t = useFrequencyStore((s) => s.t);
  const hz = useFrequencyStore((s) => s.hz);
  const dips = useFrequencyStore((s) => s.dips);
  const lagS = useFrequencyStore((s) => s.lagS);
  const [windowKey, setWindowKey] = useStoredState<string>("power:window", "300");
  const [rangeKey, setRangeKey] = useStoredState<string>("power:range", "250");
  const windowS = Number(windowKey) || 300;
  const rangeMhz = Number(rangeKey) || 250;
  const reduced = usePrefersReducedMotion();
  // The flowing trace is ambient: at rest, or with reduced motion, it redraws when a batch arrives.
  const ambient = useAmbientMotion();
  const stepping = reduced || !ambient;

  const canvas = useRef<HTMLCanvasElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const size = useRef({ w: 0, h: 0, dpr: 1 });
  const cursor = useRef<number | null>(null);
  const speed = useRef(1);
  const lastReadingUpdate = useRef(0);
  const [reading, setReading] = useState<Reading | null>(null);
  const ready = t.length > 0;
  const live = useRef({ t, hz, dips, windowS, rangeMhz });
  live.current = { t, hz, dips, windowS, rangeMhz };

  // Keep the backing store sharp on every display density and when the panel resizes.
  useEffect(() => {
    const el = box.current;
    const c = canvas.current;
    if (!el || !c) return;
    const fit = (): void => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = el.clientWidth;
      const h = el.clientHeight;
      size.current = { w, h, dpr };
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
      if (stepping) draw(performance.now());
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepping, ready]);

  const draw = (now: number): void => {
    const c = canvas.current;
    const ctx = c?.getContext("2d");
    const { w, h, dpr } = size.current;
    const { t: ts, hz: hs, dips: ds, windowS: W, rangeMhz: R } = live.current;
    if (!c || !ctx || w === 0 || ts.length === 0) return;
    const at = cursor.current ?? (ts[ts.length - 1] ?? 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const px = PAD.left;
    const py = PAD.top;
    const pw = w - PAD.left - PAD.right;
    const ph = h - PAD.top - PAD.bottom;
    const mid = py + ph / 2;
    const yOf = (value: number): number => mid - ((value - 50) * 1000 * (ph / 2)) / R;
    const xOf = (time: number): number => px + ((time - (at - W)) / W) * pw;

    ctx.font = '10px "Plex Mono", ui-monospace, monospace';
    ctx.textBaseline = "middle";

    // Bands: normal range in mint, everything past ±200 mHz in alarm.
    const band = (from: number, to: number, color: string): void => {
      const a = Math.max(py, yOf(50 + to / 1000));
      const b = Math.min(py + ph, yOf(50 + from / 1000));
      if (b > a) {
        ctx.fillStyle = color;
        ctx.fillRect(px, a, pw, b - a);
      }
    };
    band(-50, 50, "rgba(111, 242, 180, 0.055)");
    band(200, R + 1, "rgba(255, 79, 94, 0.07)");
    band(-R - 1, -200, "rgba(255, 79, 94, 0.07)");

    // Time grid.
    const step = GRID_S[W] ?? 60;
    ctx.strokeStyle = "rgba(226, 234, 240, 0.05)";
    ctx.fillStyle = MAP_INK.ash;
    ctx.lineWidth = 1;
    ctx.textAlign = "center";
    for (let g = Math.ceil((at - W) / step) * step; g <= at; g += step) {
      const x = Math.round(xOf(g)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(x, py);
      ctx.lineTo(x, py + ph);
      ctx.stroke();
      ctx.fillText(new Date(g * 1000).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }), x, h - 10);
    }

    // Frequency lines. Dashes mark the edges of the bands.
    const line = (mhz: number, color: string, dash: number[], label: string | null, strong = false): void => {
      if (Math.abs(mhz) > R) return;
      const y = Math.round(yOf(50 + mhz / 1000)) + 0.5;
      ctx.strokeStyle = color;
      ctx.lineWidth = strong ? 1.25 : 1;
      ctx.setLineDash(dash);
      ctx.beginPath();
      ctx.moveTo(px, y);
      ctx.lineTo(px + pw, y);
      ctx.stroke();
      ctx.setLineDash([]);
      if (label) {
        ctx.fillStyle = strong ? MAP_INK.bone : color;
        ctx.textAlign = "right";
        ctx.fillText(label, px - 8, y);
      }
    };
    line(0, "rgba(230, 236, 240, 0.34)", [], "50.00", true);
    line(50, "rgba(111, 242, 180, 0.35)", [3, 4], "+50");
    line(-50, "rgba(111, 242, 180, 0.35)", [3, 4], "−50");
    line(200, "rgba(255, 79, 94, 0.6)", [6, 4], "+200");
    line(-200, "rgba(255, 79, 94, 0.6)", [6, 4], "−200");
    ctx.fillStyle = MAP_INK.ash;
    ctx.textAlign = "right";
    ctx.fillText("mHz", px - 8, py + 2);

    // Words for the bands, inside the plot.
    ctx.textAlign = "left";
    ctx.fillStyle = "rgba(111, 242, 180, 0.75)";
    const normalY = yOf(50.05) - 9;
    if (normalY > py) ctx.fillText("NORMAL RANGE ±50 mHz", px + 8, normalY);
    if (R >= 200) {
      ctx.fillStyle = "rgba(255, 79, 94, 0.9)";
      ctx.fillText("ALL RESERVES ENGAGED ±200 mHz", px + 8, yOf(50.2) - 9 > py ? yOf(50.2) - 9 : yOf(50.2) + 9);
    } else {
      ctx.fillStyle = MAP_INK.ash;
      ctx.textAlign = "right";
      ctx.fillText("±200 mHz lies beyond this view", px + pw - 8, py + 8);
    }

    // The trace.
    const first = ts.findIndex((x) => x >= at - W - 2);
    const start = first === -1 ? ts.length : Math.max(0, first - 1);
    const path = new Path2D();
    let started = false;
    let lastX = px;
    let lastY = mid;
    for (let i = start; i < ts.length; i++) {
      const time = ts[i] ?? 0;
      if (time > at) break;
      const x = xOf(time);
      const y = yOf(hs[i] ?? 50);
      if (!started) {
        path.moveTo(x, y);
        started = true;
      } else path.lineTo(x, y);
      lastX = x;
      lastY = y;
    }
    const head = frequencyAt(ts, hs, at);
    if (head !== null) {
      lastX = xOf(at);
      lastY = yOf(head);
      if (started) path.lineTo(lastX, lastY);
      else path.moveTo(lastX, lastY);
    }

    ctx.save();
    ctx.beginPath();
    ctx.rect(px, py, pw, ph);
    ctx.clip();
    const fill = new Path2D(path);
    fill.lineTo(lastX, mid);
    fill.lineTo(Math.max(px, xOf(ts[start] ?? at - W)), mid);
    fill.closePath();
    const grad = ctx.createLinearGradient(0, py, 0, py + ph);
    grad.addColorStop(0, "rgba(255, 181, 71, 0.16)");
    grad.addColorStop(0.5, "rgba(255, 181, 71, 0.02)");
    grad.addColorStop(1, "rgba(255, 181, 71, 0.16)");
    ctx.fillStyle = grad;
    ctx.fill(fill);
    ctx.shadowColor = "rgba(255, 181, 71, 0.55)";
    ctx.shadowBlur = 10;
    ctx.strokeStyle = MAP_INK.sodium;
    ctx.lineWidth = 1.6;
    ctx.lineJoin = "round";
    ctx.stroke(path);
    ctx.restore();

    // Dips: where something big tripped.
    for (const d of ds) {
      if (d.at < at - W || d.at > at) continue;
      const x = xOf(d.at);
      ctx.strokeStyle = "rgba(255, 79, 94, 0.55)";
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 4]);
      ctx.beginPath();
      ctx.moveTo(x, py);
      ctx.lineTo(x, py + ph);
      ctx.stroke();
      ctx.setLineDash([]);
      const here = frequencyAt(ts, hs, d.at) ?? 50;
      const pulse = stepping ? 0 : ((now / 900) % 1) * 10;
      ctx.strokeStyle = `rgba(255, 79, 94, ${0.9 - pulse / 12})`;
      ctx.beginPath();
      ctx.arc(x, yOf(here), 5 + pulse, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = MAP_INK.alarm;
      ctx.textAlign = x > px + pw - 120 ? "right" : "left";
      ctx.fillText(`−${d.depthMhz} mHz · ${new Date(d.at * 1000).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`, x + (x > px + pw - 120 ? -8 : 8), py + 10);
    }

    // The head of the trace.
    if (head !== null) {
      const beat = stepping ? 0 : (now / 1400) % 1;
      ctx.strokeStyle = `rgba(255, 181, 71, ${0.5 * (1 - beat)})`;
      ctx.lineWidth = 1.25;
      ctx.beginPath();
      ctx.arc(lastX, lastY, 4 + beat * 12, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = MAP_INK.bone;
      ctx.beginPath();
      ctx.arc(lastX, lastY, 2.6, 0, Math.PI * 2);
      ctx.fill();
    }

    // The readout beside the trace updates a few times a second, not every frame.
    if (head !== null && performance.now() - lastReadingUpdate.current > 250) {
      lastReadingUpdate.current = performance.now();
      setReading({ hz: head, at });
    }
  };

  // Advance the replay head by one frame's worth of real time, nudged to keep a steady reserve behind the newest reading.
  useAnimationFrame((dt, now) => {
    const { t: ts } = live.current;
    const newest = ts[ts.length - 1];
    if (newest === undefined) return;
    let at = cursor.current;
    if (at === null || at > newest || newest - at > LEAD_MAX_S * 4) at = newest - LEAD_S;
    const lead = newest - at;
    const target = lead < LEAD_MIN_S ? 0.5 : lead > LEAD_MAX_S ? 1.6 : 1;
    speed.current += (target - speed.current) * Math.min(1, dt * 1.5);
    cursor.current = Math.min(newest, at + dt * speed.current);
    draw(now);
    // The trace crawls a few pixels a second: 30 frames a second look as smooth as 60 at half the cost.
  }, !stepping, "ambient", 30);

  useEffect(() => {
    if (!stepping) return;
    cursor.current = t[t.length - 1] ?? null;
    draw(performance.now());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepping, t, windowS, rangeMhz, dips]);

  if (t.length === 0) {
    return (
      <div className="power-hero__empty">
        <Scanning label="Listening to the grid" />
      </div>
    );
  }

  const state = reading ? describeFrequency(reading.hz) : null;
  const deltaMhz = reading ? (reading.hz - 50) * 1000 : 0;
  const recent = hz.slice(-3600);
  const lowest = recent.length ? Math.min(...recent) : null;
  const highest = recent.length ? Math.max(...recent) : null;

  return (
    <div className="power-hero">
      <div className="power-hero__top">
        <div className="power-hero__value">
          <div className="v-eyebrow v-eyebrow--ice">Frequency of the continental European grid</div>
          <div className="power-hero__number display num" aria-live="off" aria-label={reading ? `${reading.hz.toFixed(3)} hertz` : undefined}>
            {reading ? reading.hz.toFixed(3) : "—"}
            <span className="power-hero__unit">Hz</span>
          </div>
          <div className="power-hero__state">
            {state && <Tag tone={state.tone}>{state.label}</Tag>}
            {reading && <span className="num power-hero__delta">{`${deltaMhz >= 0 ? "+" : "−"}${Math.abs(deltaMhz).toFixed(0)} mHz from 50`}</span>}
          </div>
        </div>
        <div className="power-hero__controls">
          <Segmented label="Time shown" value={windowKey} options={WINDOWS} onChange={setWindowKey} />
          <Segmented label="Scale" value={rangeKey} options={RANGES} onChange={setRangeKey} />
        </div>
      </div>

      <div className="power-scope" ref={box}>
        <canvas ref={canvas} role="img" aria-label="Live trace of the European grid frequency around 50 hertz" />
      </div>

      <div className="power-hero__foot">
        <span className="power-hero__live">
          <LiveDot tone="ice" />
          {reading ? `Measured at ${fmt.clock(reading.at * 1000, true)}` : "Starting"}
          {reading && <span className="faint"> · {fmt.ago(reading.at * 1000)}, because the source publishes a few minutes late</span>}
          {lagS === null && null}
        </span>
        {lowest !== null && highest !== null && (
          <span className="num faint">
            Last hour {lowest.toFixed(3)} to {highest.toFixed(3)} Hz
          </span>
        )}
      </div>
      {dips.length === 0 && (
        <p className="power-hero__note faint">No sudden dips in the last three hours.</p>
      )}
    </div>
  );
}

export function HeartbeatError({ message }: { message: string }): ReactElement {
  return (
    <Empty title="Frequency unavailable" tone="error">
      {message} The trace comes back by itself when the source answers again.
    </Empty>
  );
}
