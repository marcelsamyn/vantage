import { motion } from "motion/react";
import { useId, useMemo, useState, type KeyboardEvent, type PointerEvent, type ReactElement } from "react";
import { fmt } from "../../app/core/format";
import { usePrefersReducedMotion } from "../../app/core/hooks";
import type { Units } from "../../app/core/settings";
import { THRESHOLDS, levelsOnGrid } from "./analysis";
import { height } from "./client";
import type { GaugeReading, SeaLevel, Swing } from "./types";
import "./sea.css";

const W = 308;
const TOP = { y0: 8, y1: 104 };
const STRIP = { y0: 132, y1: 184 };
const AXIS_Y = 199;
const H = 206;

type Series = readonly (number | null)[];

/** Join consecutive readings into one path; a gap longer than `maxGap` grid steps starts a new stroke. */
function pathOf(values: Series, x: (k: number) => number, y: (v: number) => number, maxGap: number, keep: (k: number) => boolean = () => true): string {
  let d = "";
  let previous = -Infinity;
  values.forEach((v, k) => {
    if (v === null || !keep(k)) return;
    d += `${k - previous > maxGap ? "M" : "L"}${x(k).toFixed(1)},${y(v).toFixed(1)}`;
    previous = k;
  });
  return d.startsWith("L") ? `M${d.slice(1)}` : d;
}

const SWING_FILL: Record<SeaLevel, string> = { normal: "transparent", restless: "var(--sodium-dim)", unusual: "var(--alarm-dim)" };

/**
 * The hero of a gauge profile: the last 24 hours of sea level above, and below it the same record with the tide taken
 * out, so that a seiche stands out as a wiggle against the gauge's usual band. Stretches that earned "restless" or
 * "unusual" are drawn in amber and red. Move over it to read any minute.
 */
export function GaugeChart({ reading, units }: { reading: GaugeReading; units: Units }): ReactElement {
  const { levelMm, tideFreeMm, startMs, stepMs, analysis, gauge } = reading;
  const reduced = usePrefersReducedMotion();
  const gradient = useId();
  const [hover, setHover] = useState<number | null>(null);
  const n = levelMm.length;
  const x = (k: number): number => (k / (n - 1)) * W;
  const maxGap = Math.max(6, gauge.intervalMin * 3);

  const geometry = useMemo(() => {
    const present = levelMm.flatMap((v) => (v === null ? [] : [v]));
    const lo = Math.min(...present);
    const hi = Math.max(...present);
    // A flat record must not be blown up into noise: the vertical scale never spans less than 4 cm.
    const mid = (lo + hi) / 2;
    const half = Math.max((hi - lo) / 2, 20) * 1.12;
    const yLevel = (v: number): number => TOP.y1 - ((v - (mid - half)) / (2 * half)) * (TOP.y1 - TOP.y0);

    const residuals = tideFreeMm.flatMap((v) => (v === null ? [] : [Math.abs(v)]));
    const unusualHalfMm = (Math.max(THRESHOLDS.unusual.floorM, THRESHOLDS.unusual.times * analysis.quietM) / 2) * 1000;
    const peak = residuals.length ? [...residuals].sort((a, b) => a - b)[Math.floor(residuals.length * 0.995)] ?? 0 : 0;
    const span = Math.max(unusualHalfMm * 1.25, peak * 1.1, 30);
    const yTide = (v: number): number => (STRIP.y0 + STRIP.y1) / 2 - (v / span) * ((STRIP.y1 - STRIP.y0) / 2);
    const levels = levelsOnGrid(tideFreeMm, analysis.quietM, analysis.coarse);
    return { lo, hi, yLevel, yTide, unusualHalfMm, levels, quietHalfMm: (analysis.quietM / 2) * 1000 };
  }, [levelMm, tideFreeMm, analysis]);

  const line = useMemo(() => pathOf(levelMm, x, geometry.yLevel, maxGap), [levelMm, geometry, maxGap]);
  const area = line ? `${line}L${W},${TOP.y1}L${x(levelMm.findIndex((v) => v !== null)).toFixed(1)},${TOP.y1}Z` : "";
  const tide = useMemo(() => pathOf(tideFreeMm, x, geometry.yTide, maxGap), [tideFreeMm, geometry, maxGap]);
  const restless = useMemo(() => pathOf(tideFreeMm, x, geometry.yTide, maxGap, (k) => geometry.levels[k] === "restless"), [tideFreeMm, geometry, maxGap]);
  const unusual = useMemo(() => pathOf(tideFreeMm, x, geometry.yTide, maxGap, (k) => geometry.levels[k] === "unusual"), [tideFreeMm, geometry, maxGap]);

  const lastK = levelMm.reduce<number>((acc, v, k) => (v === null ? acc : k), 0);
  const lastV = levelMm[lastK] ?? 0;

  const ticks = useMemo(() => {
    const out: { k: number; label: string }[] = [];
    for (let k = 0; k < n; k++) {
      const d = new Date(startMs + k * stepMs);
      if (d.getMinutes() === 0 && d.getHours() % 6 === 0) out.push({ k, label: `${String(d.getHours()).padStart(2, "0")}:00` });
    }
    return out;
  }, [n, startMs, stepMs]);

  const swings: Swing[] = [analysis.day, ...(analysis.recent.to !== analysis.day.to ? [analysis.recent] : [])].filter((s) => s.level !== "normal");
  const kOf = (ms: number): number => Math.min(n - 1, Math.max(0, Math.round((ms - startMs) / stepMs)));

  const onMove = (e: PointerEvent<SVGSVGElement>): void => {
    const box = e.currentTarget.getBoundingClientRect();
    const k = Math.round(((e.clientX - box.left) / box.width) * (n - 1));
    // Snap to the nearest minute that has a reading.
    for (let d = 0; d <= 6; d++) {
      for (const j of [k - d, k + d]) if (levelMm[j] !== null && levelMm[j] !== undefined) return setHover(j);
    }
    setHover(null);
  };

  // The arrow keys read the record the way the pointer does: about a quarter of an hour per press, skipping gaps.
  const keyStep = Math.max(1, Math.round(n / 96));
  const readingFrom = (k: number, dir: 1 | -1): number | null => {
    for (let j = Math.min(n - 1, Math.max(0, k)); j >= 0 && j < n; j += dir) if (levelMm[j] !== null && levelMm[j] !== undefined) return j;
    return null;
  };
  const onKey = (e: KeyboardEvent<SVGSVGElement>): void => {
    const at = hover ?? lastK;
    const next = e.key === "ArrowLeft" ? readingFrom(at - keyStep, -1) : e.key === "ArrowRight" ? readingFrom(at + keyStep, 1) : e.key === "Home" ? readingFrom(0, 1) : e.key === "End" ? readingFrom(n - 1, -1) : undefined;
    if (next === undefined) return;
    e.preventDefault();
    if (next !== null) setHover(next);
  };

  const hv = hover !== null ? levelMm[hover] : null;
  const ht = hover !== null ? tideFreeMm[hover] : null;
  const spoken =
    hover !== null && hv != null
      ? `${fmt.clock(startMs + hover * stepMs)}, ${height(hv / 1000, units)}${ht != null ? `, tide taken out ${ht >= 0 ? "plus" : "minus"} ${height(Math.abs(ht) / 1000, units)}` : ""}`
      : `latest reading ${height(lastV / 1000, units)}`;
  const draw = reduced ? false : { pathLength: 0 };

  return (
    <figure className="sea-chart">
      <div className="sea-chart__readout" aria-live="off">
        {hover !== null && hv != null ? (
          <>
            <span className="num">{fmt.clock(startMs + hover * stepMs)}</span>
            <span className="num">{height(hv / 1000, units)}</span>
            {ht != null && <span className="sea-chart__muted">tide taken out: {ht >= 0 ? "+" : "−"}{height(Math.abs(ht) / 1000, units)}</span>}
          </>
        ) : (
          <span className="sea-chart__muted">Last 24 hours, local time. Move over the chart, or focus it and use the arrow keys, to read a minute.</span>
        )}
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        className="sea-chart__svg"
        role="slider"
        tabIndex={0}
        aria-label={`Sea level at ${gauge.name} over the last 24 hours, with the tide taken out below. Left and right arrow keys read another time.`}
        aria-valuemin={0}
        aria-valuemax={n - 1}
        aria-valuenow={hover ?? lastK}
        aria-valuetext={spoken}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
        onKeyDown={onKey}
        onFocus={() => setHover((h) => h ?? lastK)}
        onBlur={() => setHover(null)}
      >
        <defs>
          <linearGradient id={gradient} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="var(--sodium)" stopOpacity="0.26" />
            <stop offset="1" stopColor="var(--sodium)" stopOpacity="0" />
          </linearGradient>
        </defs>

        {ticks.map((t) => (
          <g key={t.k}>
            <line x1={x(t.k)} x2={x(t.k)} y1={TOP.y0} y2={STRIP.y1} className="sea-chart__grid" />
            <text x={x(t.k)} y={AXIS_Y} textAnchor={t.k === 0 ? "start" : "middle"} className="sea-chart__axis">
              {t.label}
            </text>
          </g>
        ))}

        {swings.map((s) => (
          <g key={`${s.level}-${s.to}`}>
            <rect x={x(kOf(s.from))} width={Math.max(2, x(kOf(s.to)) - x(kOf(s.from)))} y={TOP.y0} height={TOP.y1 - TOP.y0} fill={SWING_FILL[s.level]} />
            <rect x={x(kOf(s.from))} width={Math.max(2, x(kOf(s.to)) - x(kOf(s.from)))} y={STRIP.y0} height={STRIP.y1 - STRIP.y0} fill={SWING_FILL[s.level]} />
          </g>
        ))}

        <text x={2} y={TOP.y0 + 8} className="sea-chart__axis">
          {height(geometry.hi / 1000, units)}
        </text>
        <text x={2} y={TOP.y1 - 3} className="sea-chart__axis">
          {height(geometry.lo / 1000, units)}
        </text>
        {area && <path d={area} fill={`url(#${gradient})`} />}
        {line && <motion.path d={line} className="sea-chart__level" initial={draw} animate={{ pathLength: 1 }} transition={{ duration: 0.9, ease: "easeOut" }} />}

        <text x={2} y={STRIP.y0 - 6} className="sea-chart__label">
          Tide taken out
        </text>
        <rect x={0} width={W} y={geometry.yTide(geometry.quietHalfMm)} height={Math.max(1, geometry.yTide(-geometry.quietHalfMm) - geometry.yTide(geometry.quietHalfMm))} className="sea-chart__band" />
        {[geometry.unusualHalfMm, -geometry.unusualHalfMm].map((v) => (
          <line key={v} x1={0} x2={W} y1={geometry.yTide(v)} y2={geometry.yTide(v)} className="sea-chart__limit" />
        ))}
        {!analysis.coarse && (
          <text x={W - 2} y={geometry.yTide(geometry.unusualHalfMm) - 3} textAnchor="end" className="sea-chart__axis">
            unusual beyond this
          </text>
        )}
        {tide && <motion.path d={tide} className="sea-chart__tide" initial={draw} animate={{ pathLength: 1 }} transition={{ duration: 0.9, ease: "easeOut", delay: 0.15 }} />}
        {restless && <path d={restless} className="sea-chart__flag sea-chart__flag--restless" />}
        {unusual && <path d={unusual} className="sea-chart__flag sea-chart__flag--unusual" />}

        <g transform={`translate(${x(lastK)},${geometry.yLevel(lastV)})`}>
          <circle r="3" className="sea-chart__now" />
          {!reduced && <circle r="3" className="sea-chart__ping" />}
        </g>

        {hover !== null && hv != null && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={TOP.y0} y2={STRIP.y1} className="sea-chart__cursor" />
            <circle cx={x(hover)} cy={geometry.yLevel(hv)} r="3" className="sea-chart__cursor-dot" />
            {ht != null && <circle cx={x(hover)} cy={geometry.yTide(ht)} r="2.5" className="sea-chart__cursor-dot" />}
          </g>
        )}
      </svg>
      <figcaption className="sea-chart__caption sea-chart__muted">
        Heights are measured from this gauge's own zero, so two gauges cannot be compared.
      </figcaption>
    </figure>
  );
}
