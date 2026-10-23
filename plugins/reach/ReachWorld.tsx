import { Minus, Plus } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactElement } from "react";
import { fmt } from "../../app/core/format";
import { useAmbientMotion, useAnimationFrame, usePrefersReducedMotion } from "../../app/core/hooks";
import { profile, useProfile } from "../../app/core/profile";
import { Button, IconButton, LiveDot } from "../../app/ui";
import type { LatLon } from "../../shared/geo";
import { MAP_INK } from "../city/extension";
import { isFull, loadOf, seatsText, type GroundStation, type LandGrid, type Receiver, type WorkOrder } from "./types";

/** Latitudes shown: Antarctica and the polar ice are cropped; every receiver and station is inside. */
const LAT_MIN = -56;
const LAT_MAX = 80;
const MAX_SCALE = 120;
/** Work orders are only drawn once the view is tighter than this many pixels per degree, about a region. */
const ORDER_SCALE = 30;

interface View {
  lon: number;
  lat: number;
  /** Pixels per degree. */
  s: number;
}

type Hit = { x: number; y: number; r: number; label: string; sub: string; open: () => void; key: string };

export interface WorldProps {
  receivers: readonly Receiver[];
  stations: readonly GroundStation[];
  orders: readonly WorkOrder[];
  here: LatLon | null;
  land: LandGrid | undefined;
  active: boolean;
  /** Ask the view to fly to a place; a new `nonce` repeats the request. */
  flyTo: { at: LatLon; scale: number; nonce: number } | null;
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/**
 * Everything within reach, on one plate: land as a lattice of dots, radio receivers that glow with their listeners,
 * ground stations that pulse while recording, and, zoomed in near you, the open work orders of your city.
 */
export function ReachWorld({ receivers, stations, orders, here, land, active, flyTo }: WorldProps): ReactElement {
  const reduced = usePrefersReducedMotion();
  // True while the frame loop below runs. When it does not (reduced motion, a resting page), a change of view
  // has to ask for its own frame, and nothing eases, so the view jumps.
  const looping = useAmbientMotion() && active;
  const loopingRef = useRef(looping);
  loopingRef.current = looping;
  const drawRef = useRef<(dt: number, now: number) => void>(() => {});
  const redrawFrame = useRef(0);
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const size = useRef({ w: 0, h: 0, dpr: 1 });
  const view = useRef<View>({ lon: 10, lat: 22, s: 1 });
  const target = useRef<View>({ lon: 10, lat: 22, s: 1 });
  const hits = useRef<Hit[]>([]);
  const stillLayer = useRef<{ canvas: HTMLCanvasElement; key: unknown[] } | null>(null);
  const drag = useRef<{ x: number; y: number; moved: number } | null>(null);
  const [tip, setTip] = useState<{ x: number; y: number; label: string; sub: string; key: string } | null>(null);
  const selected = useProfile((s) => (s.entity && ["receiver", "groundstation", "workorder"].includes(s.entity.kind) ? `${s.entity.kind}:${s.entity.id}` : null));

  const dots = useMemo(() => {
    if (!land) return [] as [number, number][];
    const out: [number, number][] = [];
    land.rows.forEach((row, r) => {
      for (let c = 0; c < row.length; c++) if (row[c] === "1") out.push([-180 + (c + 0.5) * land.stepDeg, 90 - (r + 0.5) * land.stepDeg]);
    });
    return out;
  }, [land]);

  const fitScale = (): number => Math.max(size.current.w / 360, size.current.h / (LAT_MAX - LAT_MIN));

  const constrain = useCallback((v: View): View => {
    const { w, h } = size.current;
    const s = clamp(v.s, fitScale(), MAX_SCALE);
    const hw = w / 2 / s;
    const hh = h / 2 / s;
    const lon = hw >= 180 ? 0 : clamp(v.lon, -180 + hw, 180 - hw);
    const mid = (LAT_MIN + LAT_MAX) / 2;
    const lat = hh * 2 >= LAT_MAX - LAT_MIN ? mid : clamp(v.lat, LAT_MIN + hh, LAT_MAX - hh);
    return { lon, lat, s };
  }, []);

  const go = useCallback(
    (next: View, jump = false): void => {
      target.current = constrain(next);
      if (jump || reduced || !loopingRef.current) view.current = target.current;
      if (loopingRef.current || redrawFrame.current) return;
      redrawFrame.current = requestAnimationFrame((now) => {
        redrawFrame.current = 0;
        drawRef.current(0, now);
      });
    },
    [constrain, reduced],
  );
  useEffect(() => () => cancelAnimationFrame(redrawFrame.current), []);

  // Size the canvas to its box and start with the whole world in view, centred on you when the box is narrower than the world.
  useEffect(() => {
    const el = box.current;
    const cv = canvas.current;
    if (!el || !cv) return;
    const resize = (): void => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      size.current = { w, h, dpr };
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
      go({ ...target.current, s: Math.max(target.current.s, fitScale()) }, true);
    };
    const first = size.current.w === 0;
    resize();
    if (first) go({ lon: here?.lon ?? 10, lat: here?.lat ?? 22, s: fitScale() }, true);
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (flyTo) go({ lon: flyTo.at.lon, lat: flyTo.at.lat, s: flyTo.scale });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flyTo?.nonce]);

  // The wheel needs a non-passive listener, or the page would scroll while you zoom.
  useEffect(() => {
    const cv = canvas.current;
    if (!cv) return;
    // Plain scrolling belongs to the page. Ctrl or ⌘ with the wheel, and a trackpad pinch (which arrives as Ctrl), zoom the map.
    const onWheel = (e: WheelEvent): void => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const rect = cv.getBoundingClientRect();
      zoomAt(e.clientX - rect.left, e.clientY - rect.top, Math.exp(-e.deltaY * 0.0016));
    };
    cv.addEventListener("wheel", onWheel, { passive: false });
    return () => cv.removeEventListener("wheel", onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function zoomAt(px: number, py: number, factor: number): void {
    const { w, h } = size.current;
    const t = target.current;
    const lonAt = t.lon + (px - w / 2) / t.s;
    const latAt = t.lat - (py - h / 2) / t.s;
    const s = clamp(t.s * factor, fitScale(), MAX_SCALE);
    go({ s, lon: lonAt - (px - w / 2) / s, lat: latAt + (py - h / 2) / s });
  }

  const draw = (dt: number, now: number): void => {
    const cv = canvas.current;
    const ctx = cv?.getContext("2d");
    if (!cv || !ctx) return;
    const { w, h, dpr } = size.current;
    // Ease the view toward its target; a fixed fraction per frame at 60 fps, scaled by the real frame time.
    const k = reduced ? 1 : 1 - Math.exp(-dt * 11);
    const v = view.current;
    const t = target.current;
    v.lon += (t.lon - v.lon) * k;
    v.lat += (t.lat - v.lat) * k;
    v.s *= Math.pow(t.s / v.s, k);
    // Land exactly on the target, so a settled view stops redrawing the still layer.
    if (Math.abs(t.lon - v.lon) * v.s < 0.05 && Math.abs(t.lat - v.lat) * v.s < 0.05 && Math.abs(t.s / v.s - 1) < 1e-4) {
      v.lon = t.lon;
      v.lat = t.lat;
      v.s = t.s;
    }
    const px = (lon: number): number => w / 2 + (lon - v.lon) * v.s;
    const py = (lat: number): number => h / 2 - (lat - v.lat) * v.s;
    const pulse = reduced ? 0.5 : (Math.sin(now / 520) + 1) / 2;

    function drawStill(ctx: CanvasRenderingContext2D): Hit[] {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const onScreen = (x: number, y: number): boolean => x > -20 && x < w + 20 && y > -20 && y < h + 20;
      // Graticule
      ctx.lineWidth = 1;
      ctx.strokeStyle = "rgba(226, 234, 240, 0.05)";
      ctx.beginPath();
      for (let lon = -180; lon <= 180; lon += 30) {
        const x = Math.round(px(lon)) + 0.5;
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
      }
      for (let lat = -60; lat <= 90; lat += 30) {
        const y = Math.round(py(lat)) + 0.5;
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
      }
      ctx.stroke();

      // Land: the lattice thins into the background as you zoom, so points stay the subject.
      const spacing = (land?.stepDeg ?? 2) * v.s;
      const landAlpha = clamp(1.1 - spacing / 60, 0.15, 0.55);
      ctx.fillStyle = `rgba(139, 151, 163, ${landAlpha})`;
      const dotR = clamp(spacing * 0.17, 0.7, 2.6);
      for (const [lon, lat] of dots) {
        const x = px(lon);
        const y = py(lat);
        if (x < -4 || x > w + 4 || y < -4 || y > h + 4) continue;
        ctx.fillRect(x - dotR, y - dotR, dotR * 2, dotR * 2);
      }

      const list: Hit[] = [];

      // Receivers: glow grows with listeners. A full receiver goes grey because nobody else can join.
      ctx.globalCompositeOperation = "lighter";
      for (const r of receivers) {
        const x = px(r.lon);
        const y = py(r.lat);
        if (!onScreen(x, y)) continue;
        const load = loadOf(r);
        const full = isFull(r);
        ctx.fillStyle = full ? `rgba(86, 97, 109, 0.3)` : `rgba(255, 181, 71, ${0.05 + load * 0.2})`;
        ctx.beginPath();
        ctx.arc(x, y, 4 + load * 9, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalCompositeOperation = "source-over";
      for (const r of receivers) {
        const x = px(r.lon);
        const y = py(r.lat);
        if (!onScreen(x, y)) continue;
        const load = loadOf(r);
        const full = isFull(r);
        ctx.fillStyle = full ? MAP_INK.ash : MAP_INK.sodium;
        ctx.globalAlpha = full ? 0.9 : 0.55 + load * 0.45;
        ctx.beginPath();
        ctx.arc(x, y, 1.5 + load * 1.4, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
        list.push({
          x,
          y,
          r: 9,
          key: `receiver:${r.id}`,
          label: r.name,
          sub: seatsText(r),
          open: () => profile.open({ kind: "receiver", id: r.id, data: r }),
        });
      }

      // Ground stations: a ring, filled while a pass is being recorded.
      for (const s of stations) {
        const x = px(s.lon);
        const y = py(s.lat);
        if (!onScreen(x, y)) continue;
        const recording = s.observing !== null && s.observing.endsAt > Date.now();
        ctx.lineWidth = 1.4;
        ctx.strokeStyle = recording ? MAP_INK.sodium : MAP_INK.mint;
        ctx.fillStyle = recording ? MAP_INK.sodium : MAP_INK.void;
        ctx.globalAlpha = s.status === "online" ? 1 : 0.55;
        ctx.beginPath();
        ctx.arc(x, y, 3.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.globalAlpha = 1;
        list.push({
          x,
          y,
          r: 10,
          key: `groundstation:${s.id}`,
          label: s.name,
          sub: recording && s.observing ? `Recording ${s.observing.satellite}` : s.status === "online" ? "Ground station, online" : "Ground station, testing",
          open: () => profile.open({ kind: "groundstation", id: String(s.id), data: s }),
        });
      }

      // Work orders appear when you are close enough to tell them apart.
      if (v.s >= ORDER_SCALE) {
        ctx.fillStyle = MAP_INK.bone;
        for (const o of orders) {
          const x = px(o.lon);
          const y = py(o.lat);
          if (!onScreen(x, y)) continue;
          ctx.fillRect(x - 3, y - 3, 6, 6);
          list.push({ x, y, r: 10, key: `workorder:${o.id}`, label: o.category, sub: `${o.operator}, reported ${fmt.ago(o.createdAt)}`, open: () => profile.open({ kind: "workorder", id: o.id, data: o }) });
        }
      }

      // The selection
      const chosen = selected ? list.find((hit) => hit.key === selected) : undefined;
      if (chosen) {
        ctx.strokeStyle = MAP_INK.ice;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(chosen.x, chosen.y, 9, 0, Math.PI * 2);
        ctx.stroke();
      }
      return list;
    }

    // Everything but the pulses changes only with the view, the data or the selection. It is drawn into its own
    // layer when one of those changes; a frame that only pulses copies the layer and draws the rings.
    // Recording and "reported … ago" follow the clock, so the layer is redrawn when a pass ends and each minute.
    const recordingIds = stations.filter((s) => s.observing !== null && s.observing.endsAt > Date.now()).map((s) => s.id).join();
    const key = [v.lon, v.lat, v.s, w, h, dpr, dots, receivers, stations, orders, selected, recordingIds, Math.floor(Date.now() / 60_000)];
    let still = stillLayer.current;
    if (!still || still.canvas.width !== cv.width || still.canvas.height !== cv.height) {
      const layerCanvas = document.createElement("canvas");
      layerCanvas.width = cv.width;
      layerCanvas.height = cv.height;
      still = { canvas: layerCanvas, key: [] };
      stillLayer.current = still;
    }
    const lc = still.canvas.getContext("2d");
    if (!lc) return;
    if (key.some((k, i) => k !== still.key[i])) {
      still.key = key;
      hits.current = drawStill(lc);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.drawImage(still.canvas, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const onScreen = (x: number, y: number): boolean => x > -20 && x < w + 20 && y > -20 && y < h + 20;

    // A ground station that records a pass sends out a ring that grows and fades.
    for (const s of stations) {
      if (s.observing === null || s.observing.endsAt <= Date.now()) continue;
      const x = px(s.lon);
      const y = py(s.lat);
      if (!onScreen(x, y)) continue;
      const phase = reduced ? 0.4 : (now / 1400 + s.id * 0.37) % 1;
      ctx.lineWidth = 1.4;
      ctx.strokeStyle = `rgba(255, 181, 71, ${0.7 * (1 - phase)})`;
      ctx.beginPath();
      ctx.arc(x, y, 4 + phase * 14, 0, Math.PI * 2);
      ctx.stroke();
    }

    // You
    if (here) {
      const x = px(here.lon);
      const y = py(here.lat);
      if (onScreen(x, y)) {
        ctx.strokeStyle = `rgba(130, 228, 255, ${0.25 + 0.4 * pulse})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(x, y, 8 + pulse * 5, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = MAP_INK.ice;
        ctx.beginPath();
        ctx.arc(x, y, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = MAP_INK.ice;
        ctx.beginPath();
        ctx.moveTo(x - 12, y);
        ctx.lineTo(x - 6, y);
        ctx.moveTo(x + 6, y);
        ctx.lineTo(x + 12, y);
        ctx.moveTo(x, y - 12);
        ctx.lineTo(x, y - 6);
        ctx.moveTo(x, y + 6);
        ctx.lineTo(x, y + 12);
        ctx.stroke();
      }
    }
  };
  drawRef.current = draw;
  useAnimationFrame(draw, active);

  const nearestHit = (x: number, y: number): Hit | null => {
    let best: Hit | null = null;
    let bestD = Infinity;
    for (const hit of hits.current) {
      const d = Math.hypot(hit.x - x, hit.y - y);
      // Draw order puts stations and orders on top of receivers, so ties go to the later (upper) item.
      if (d <= hit.r && d <= bestD) {
        best = hit;
        bestD = d;
      }
    }
    return best;
  };

  const local = (e: ReactPointerEvent<HTMLCanvasElement>): { x: number; y: number } => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const onMove = (e: ReactPointerEvent<HTMLCanvasElement>): void => {
    const p = local(e);
    const d = drag.current;
    if (d) {
      const dx = p.x - d.x;
      const dy = p.y - d.y;
      d.moved += Math.abs(dx) + Math.abs(dy);
      d.x = p.x;
      d.y = p.y;
      const t = target.current;
      go({ s: t.s, lon: t.lon - dx / t.s, lat: t.lat + dy / t.s }, true);
      setTip(null);
      return;
    }
    const hit = nearestHit(p.x, p.y);
    setTip(hit ? { x: p.x, y: p.y, label: hit.label, sub: hit.sub, key: hit.key } : null);
    e.currentTarget.style.cursor = hit ? "pointer" : "grab";
  };

  const zoomCentre = (steps: number): void => zoomAt(size.current.w / 2, size.current.h / 2, Math.pow(1.8, steps));

  return (
    <div className="reach-world" ref={box}>
      <canvas
        ref={canvas}
        className="reach-world__canvas"
        role="img"
        aria-label={`World view: ${receivers.length} radio receivers and ${stations.length} satellite ground stations${here ? ", and you" : ""}. Drag to pan, use the plus and minus buttons or hold Control while scrolling to zoom, and click a point for details.`}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          const p = local(e);
          drag.current = { x: p.x, y: p.y, moved: 0 };
          e.currentTarget.style.cursor = "grabbing";
        }}
        onPointerMove={onMove}
        onPointerUp={(e) => {
          const d = drag.current;
          drag.current = null;
          e.currentTarget.style.cursor = "grab";
          if (d && d.moved < 5) nearestHit(local(e).x, local(e).y)?.open();
        }}
        onPointerLeave={() => setTip(null)}
      />
      {tip && (
        <div className="reach-world__tip" style={{ left: Math.min(tip.x + 14, (size.current.w || 300) - 190), top: Math.max(8, tip.y - 44) }}>
          <div className="reach-world__tipname">{tip.label}</div>
          <div className="reach-world__tipsub">{tip.sub}</div>
        </div>
      )}
      <div className="reach-world__legend" aria-hidden>
        <span>
          <i className="reach-key reach-key--rx" /> Radios
        </span>
        <span>
          <i className="reach-key reach-key--gs" /> Ground stations
        </span>
        <span>
          <LiveDot tone="sodium" /> Recording
        </span>
        <span>
          <i className="reach-key reach-key--wo" /> Work orders (zoom in)
        </span>
      </div>
      <div className="reach-world__controls">
        <Button size="sm" onClick={() => go({ lon: here?.lon ?? 10, lat: here?.lat ?? 22, s: fitScale() })}>
          World
        </Button>
        <Button size="sm" disabled={!here} onClick={() => here && go({ lon: here.lon, lat: here.lat, s: 60 })}>
          Around you
        </Button>
        <IconButton label="Zoom out" onClick={() => zoomCentre(-1)}>
          <Minus size={14} />
        </IconButton>
        <IconButton label="Zoom in" onClick={() => zoomCentre(1)}>
          <Plus size={14} />
        </IconButton>
      </div>
    </div>
  );
}
