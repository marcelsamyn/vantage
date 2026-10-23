import { motion } from "motion/react";
import { useId, type ReactElement } from "react";
import { usePrefersReducedMotion } from "../../app/core/hooks";

const W = 320;
const H = 92;
const PAD_TOP = 6;
const PAD_BOTTOM = 4;
const AXIS_H = 14;

export interface ChartSeries {
  points: readonly { at: number; v: number }[];
  tone: "sodium" | "fog" | "alarm";
  /** A gap longer than this breaks the line instead of drawing across it. */
  gapMs: number;
}

export interface ChartBand {
  from: number;
  to: number;
  label: string;
}

export interface ChartTick {
  at: number;
  label: string;
}

export interface ChartGuide {
  v: number;
  label: string;
}

interface Props {
  series: readonly ChartSeries[];
  from: number;
  to: number;
  min: number;
  max: number;
  ticks: readonly ChartTick[];
  guides?: readonly ChartGuide[];
  bands?: readonly ChartBand[];
  ariaLabel: string;
}

/** Local midnights inside the range, labelled with the weekday. */
export function dayTicks(from: number, to: number): ChartTick[] {
  const out: ChartTick[] = [];
  const d = new Date(from);
  d.setHours(24, 0, 0, 0);
  for (; d.getTime() < to; d.setDate(d.getDate() + 1)) out.push({ at: d.getTime(), label: d.toLocaleDateString("en-GB", { weekday: "short" }) });
  return out;
}

/** Every `stepHours` local hours inside the range, labelled "06:00". */
export function hourTicks(from: number, to: number, stepHours: number): ChartTick[] {
  const out: ChartTick[] = [];
  const d = new Date(from);
  d.setMinutes(0, 0, 0);
  if (d.getTime() < from) d.setHours(d.getHours() + 1);
  while (d.getHours() % stepHours !== 0) d.setHours(d.getHours() + 1);
  for (; d.getTime() < to; d.setHours(d.getHours() + stepHours)) out.push({ at: d.getTime(), label: `${String(d.getHours()).padStart(2, "0")}:00` });
  return out;
}

/**
 * A line chart for the Earth's shields panel. Lines draw in from the left; the newest point of the first series
 * carries a live marker. `bands` shade stretches of time with a label (e.g. a Forbush decrease).
 */
export function ShieldsChart({ series, from, to, min, max, ticks, guides = [], bands = [], ariaLabel }: Props): ReactElement {
  const reduced = usePrefersReducedMotion();
  const clipId = `shc${useId().replace(/:/g, "")}`;
  const plotH = H - PAD_TOP - PAD_BOTTOM;
  const x = (at: number): number => ((at - from) / (to - from)) * W;
  const y = (v: number): number => PAD_TOP + (1 - (Math.min(max, Math.max(min, v)) - min) / (max - min)) * plotH;

  const paths = series.map((s) => {
    let d = "";
    let prev: number | null = null;
    for (const p of s.points) {
      d += `${prev === null || p.at - prev > s.gapMs ? "M" : "L"}${x(p.at).toFixed(1)},${y(p.v).toFixed(1)}`;
      prev = p.at;
    }
    return d;
  });
  const last = series[0]?.points.at(-1);

  return (
    <svg className="spacewx-shc" viewBox={`0 0 ${W} ${H + AXIS_H}`} role="img" aria-label={ariaLabel}>
      <defs>
        <clipPath id={clipId}>
          <motion.rect x={0} y={0} height={H + 4} initial={reduced ? false : { width: 0 }} animate={{ width: W + 6 }} transition={{ type: "spring", duration: 1.1, bounce: 0 }} />
        </clipPath>
      </defs>
      {bands.map((b) => (
        <g key={b.from}>
          <rect x={Math.max(0, x(b.from))} y={0} width={Math.max(2, Math.min(W, x(b.to)) - Math.max(0, x(b.from)))} height={H} className="spacewx-shc__band" />
          <text x={Math.min(W - 4, Math.max(4, x(b.from) + 4))} y={11} className="spacewx-shc__band-label" textAnchor={x(b.from) + 4 > W - 110 ? "end" : "start"}>
            {b.label}
          </text>
        </g>
      ))}
      {ticks.map((t) => (
        <g key={t.at}>
          <line x1={x(t.at)} x2={x(t.at)} y1={0} y2={H} className="spacewx-shc__tick" />
          <text x={x(t.at) + 3} y={H + 11} className="spacewx-shc__axis">
            {t.label}
          </text>
        </g>
      ))}
      {guides.map((g) => (
        <g key={g.v}>
          <line x1={0} x2={W} y1={y(g.v)} y2={y(g.v)} className={g.v === 0 ? "spacewx-shc__zero" : "spacewx-shc__guide"} />
          {g.label && (
            <text x={W - 2} y={y(g.v) - 3} className="spacewx-shc__axis" textAnchor="end">
              {g.label}
            </text>
          )}
        </g>
      ))}
      {series.map((s, i) => (
        <path key={i} d={paths[i]} fill="none" className={`spacewx-shc__line spacewx-shc__line--${s.tone}`} clipPath={`url(#${clipId})`} />
      ))}
      {last && (
        <g>
          <circle cx={x(last.at)} cy={y(last.v)} r={5} className={`spacewx-shc__halo spacewx-shc__halo--${series[0]?.tone}`} />
          <circle cx={x(last.at)} cy={y(last.v)} r={2.2} className={`spacewx-shc__dot spacewx-shc__dot--${series[0]?.tone}`} />
        </g>
      )}
    </svg>
  );
}
