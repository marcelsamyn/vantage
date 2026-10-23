import { animate, motion, type AnimationPlaybackControls } from "motion/react";
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactElement } from "react";
import { useAmbientMotion, usePrefersReducedMotion } from "../../app/core/hooks";
import type { Units } from "../../app/core/settings";
import { steepestCooling } from "./argo";
import { depth, temperature } from "./client";
import type { ArgoLevel } from "./types";
import "./sea.css";

const W = 308;
const H = 262;
const PLOT = { x0: 44, x1: 296, y0: 14, y1: 238 };

/** A round step (1, 2, 5, 10 ...) that gives about `count` ticks across `range`. */
function niceStep(range: number, count: number): number {
  const raw = range / count;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const f = raw / magnitude;
  return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * magnitude;
}

/**
 * Temperature against depth for one dive, drawn as a cutaway of the sea: the surface at the top, the deepest point
 * at the bottom, and a dot that climbs the curve the way the float did. The steepest cooling is shaded.
 */
export function ArgoChart({ levels, units }: { levels: readonly ArgoLevel[]; units: Units }): ReactElement {
  const reduced = usePrefersReducedMotion();
  const ambient = useAmbientMotion();
  const gradient = useId();
  const [hover, setHover] = useState<ArgoLevel | null>(null);
  const floatRef = useRef<SVGCircleElement>(null);
  const floatControls = useRef<AnimationPlaybackControls | null>(null);

  const g = useMemo(() => {
    const deepest = Math.max(...levels.map((l) => l.presDbar));
    const maxDepth = Math.ceil(deepest / 100) * 100;
    const temps = levels.map((l) => l.tempC);
    const tStep = niceStep(Math.max(...temps) - Math.min(...temps), 3);
    const tMin = Math.floor(Math.min(...temps) / tStep) * tStep;
    const tMax = Math.ceil(Math.max(...temps) / tStep) * tStep;
    const x = (t: number): number => PLOT.x0 + ((t - tMin) / (tMax - tMin)) * (PLOT.x1 - PLOT.x0);
    const y = (p: number): number => PLOT.y0 + (p / maxDepth) * (PLOT.y1 - PLOT.y0);
    const dStep = niceStep(maxDepth, 4);
    const depths = Array.from({ length: Math.floor(maxDepth / dStep) + 1 }, (_, i) => i * dStep);
    const temperatures = Array.from({ length: Math.round((tMax - tMin) / tStep) + 1 }, (_, i) => tMin + i * tStep);
    const line = levels.map((l, i) => `${i ? "L" : "M"}${x(l.tempC).toFixed(1)},${y(l.presDbar).toFixed(1)}`).join("");
    // The float rises, so the climbing dot starts at the deepest point; about 24 stops are plenty for a smooth ride.
    const stride = Math.max(1, Math.floor(levels.length / 24));
    const ride = [...levels].reverse().filter((_, i) => i % stride === 0);
    // Readings closer than 6 px apart would smear into a line, so a dot is drawn at most every 6 px.
    let lastY = -Infinity;
    const points = levels.filter((l) => {
      if (y(l.presDbar) - lastY < 6) return false;
      lastY = y(l.presDbar);
      return true;
    });
    return { maxDepth, x, y, depths, temperatures, line, ride, points, thermocline: steepestCooling(levels) };
  }, [levels]);

  // The float stays mounted and holds its place while motion rests, so it continues from there instead of restarting.
  const climbs = !reduced && g.ride.length > 1;
  useEffect(() => {
    const el = floatRef.current;
    if (!climbs || !el) return;
    const stops = g.ride.map((l) => [g.x(l.tempC), g.y(l.presDbar)] as const);
    const last = stops.length - 1;
    // Stops are evenly spaced in time. The position is written as attributes, which every browser reads for a circle.
    const controls = animate(0, last, {
      duration: 7,
      ease: "linear",
      repeat: Infinity,
      repeatDelay: 1.5,
      onUpdate: (at) => {
        const i = Math.min(last - 1, Math.floor(at));
        const from = stops[i];
        const to = stops[i + 1];
        if (!from || !to) return;
        const k = at - i;
        el.setAttribute("cx", String(from[0] + (to[0] - from[0]) * k));
        el.setAttribute("cy", String(from[1] + (to[1] - from[1]) * k));
      },
    });
    floatControls.current = controls;
    return () => {
      controls.stop();
      floatControls.current = null;
    };
  }, [climbs, g]);
  useEffect(() => {
    if (ambient) floatControls.current?.play();
    else floatControls.current?.pause();
  }, [ambient, climbs, g]);

  const onMove = (e: PointerEvent<SVGSVGElement>): void => {
    const box = e.currentTarget.getBoundingClientRect();
    const py = ((e.clientY - box.top) / box.height) * H;
    const p = ((py - PLOT.y0) / (PLOT.y1 - PLOT.y0)) * g.maxDepth;
    const nearest = levels.reduce<ArgoLevel | null>((best, l) => (best === null || Math.abs(l.presDbar - p) < Math.abs(best.presDbar - p) ? l : best), null);
    setHover(p < -20 || p > g.maxDepth + 20 ? null : nearest);
  };

  // Down and up arrows walk the dive from the surface to the deepest reading, about 40 stops in all.
  const keyStep = Math.max(1, Math.round(levels.length / 40));
  const onKey = (e: KeyboardEvent<SVGSVGElement>): void => {
    const at = hover ? levels.indexOf(hover) : 0;
    const next = e.key === "ArrowDown" ? at + keyStep : e.key === "ArrowUp" ? at - keyStep : e.key === "Home" ? 0 : e.key === "End" ? levels.length - 1 : null;
    if (next === null) return;
    e.preventDefault();
    setHover(levels[Math.min(levels.length - 1, Math.max(0, next))] ?? null);
  };
  const shown = hover ?? levels[0];
  const spoken = shown ? `${depth(shown.presDbar, units)} down, ${temperature(shown.tempC, units)}${shown.psal !== null ? `, salinity ${shown.psal.toFixed(2)}` : ""}` : "no readings";

  return (
    <figure className="sea-chart">
      <div className="sea-chart__readout">
        {hover ? (
          <>
            <span className="num">{depth(hover.presDbar, units)} down</span>
            <span className="num">{temperature(hover.tempC, units)}</span>
            {hover.psal !== null && <span className="sea-chart__muted">salinity {hover.psal.toFixed(2)}</span>}
          </>
        ) : (
          <span className="sea-chart__muted">Temperature on the way up. Move over the chart, or focus it and use the arrow keys, to read a depth.</span>
        )}
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        className="sea-chart__svg"
        role="slider"
        tabIndex={0}
        aria-orientation="vertical"
        aria-label="Water temperature against depth, from the surface down to the float's deepest point. Up and down arrow keys read another depth."
        aria-valuemin={0}
        aria-valuemax={levels.length - 1}
        aria-valuenow={hover ? levels.indexOf(hover) : 0}
        aria-valuetext={spoken}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
        onKeyDown={onKey}
        onFocus={() => setHover((h) => h ?? levels[0] ?? null)}
        onBlur={() => setHover(null)}
      >
        <defs>
          <linearGradient id={gradient} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="var(--sodium)" stopOpacity="0.14" />
            <stop offset="1" stopColor="var(--ice)" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        <rect x={PLOT.x0} y={PLOT.y0} width={PLOT.x1 - PLOT.x0} height={PLOT.y1 - PLOT.y0} fill={`url(#${gradient})`} />

        {g.thermocline && (
          <g>
            <rect x={PLOT.x0} y={g.y(g.thermocline.fromDbar)} width={PLOT.x1 - PLOT.x0} height={g.y(g.thermocline.toDbar) - g.y(g.thermocline.fromDbar)} fill="var(--sodium-dim)" />
            <text x={PLOT.x1 - 4} y={g.y(g.thermocline.toDbar) + 12} textAnchor="end" className="sea-chart__label">
              cools fastest here
            </text>
          </g>
        )}

        {g.depths.map((d) => (
          <g key={d}>
            <line x1={PLOT.x0} x2={PLOT.x1} y1={g.y(d)} y2={g.y(d)} className="sea-chart__grid" />
            <text x={PLOT.x0 - 6} y={g.y(d) + 3} textAnchor="end" className="sea-chart__axis">
              {d === 0 ? "surface" : depth(d, units)}
            </text>
          </g>
        ))}
        {g.temperatures.map((t) => (
          <g key={t}>
            <line x1={g.x(t)} x2={g.x(t)} y1={PLOT.y0} y2={PLOT.y1} className="sea-chart__grid" />
            <text x={g.x(t)} y={H - 6} textAnchor="middle" className="sea-chart__axis">
              {temperature(t, units, 0)}
            </text>
          </g>
        ))}

        <motion.path d={g.line} className="sea-chart__level" initial={reduced ? false : { pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.1, ease: "easeOut" }} />
        {g.points.map((l) => (
          <circle key={l.presDbar} cx={g.x(l.tempC)} cy={g.y(l.presDbar)} r="1.4" className="sea-chart__point" />
        ))}

        {climbs && <circle ref={floatRef} r="3.5" className="sea-chart__float" cx={g.x(g.ride[0]?.tempC ?? 0)} cy={g.y(g.ride[0]?.presDbar ?? 0)} />}

        {hover && (
          <g>
            <line x1={PLOT.x0} x2={PLOT.x1} y1={g.y(hover.presDbar)} y2={g.y(hover.presDbar)} className="sea-chart__cursor" />
            <circle cx={g.x(hover.tempC)} cy={g.y(hover.presDbar)} r="3" className="sea-chart__cursor-dot" />
          </g>
        )}
      </svg>
    </figure>
  );
}
