import { motion } from "motion/react";
import { useId, useMemo, useState, type KeyboardEvent, type PointerEvent, type ReactElement } from "react";
import { usePrefersReducedMotion } from "../../app/core/hooks";
import type { SnowPoint } from "./types";
import "./weather.css";

const W = 320;
const H = 150;
const PAD = { left: 30, right: 8, top: 12, bottom: 20 };
const DAY_S = 86_400;

/** Rounds the axis top up to a figure that reads cleanly: 10, 20, 50, 100, 200, 500 cm. */
const niceTop = (v: number): number => [10, 20, 50, 100, 200, 300, 500].find((n) => n >= v) ?? Math.ceil(v / 100) * 100;

const stamp = (t: number): string => new Date(t * 1000).toLocaleString("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit" });

/**
 * Seven days of snow depth for one station: a pale area under a line, a sodium mark over the last six hours when the snow
 * rose fast, and a hover readout. Gaps in the sensor's data are gaps in the line, not zeros.
 */
export function SnowChart({ series, fresh }: { series: readonly SnowPoint[]; fresh: boolean }): ReactElement {
  const reduced = usePrefersReducedMotion();
  const gradient = useId();
  const [hover, setHover] = useState<number | null>(null);
  const first = series[0]?.t ?? 0;
  const last = series.at(-1)?.t ?? 1;
  const top = niceTop(Math.max(1, ...series.map((p) => p.depthCm ?? 0)));
  const x = (t: number): number => PAD.left + ((t - first) / Math.max(1, last - first)) * (W - PAD.left - PAD.right);
  const y = (cm: number): number => PAD.top + (1 - cm / top) * (H - PAD.top - PAD.bottom);
  const base = y(0);

  const { line, area, freshLine } = useMemo(() => {
    const runs: SnowPoint[][] = [];
    for (const p of series) {
      if (p.depthCm === null) {
        runs.push([]);
        continue;
      }
      if (runs.length === 0) runs.push([]);
      runs.at(-1)?.push(p);
    }
    const draw = (pts: SnowPoint[]): string => pts.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${y(p.depthCm ?? 0).toFixed(1)}`).join("");
    const filled = runs.filter((r) => r.length > 1);
    const recent = series.filter((p) => p.depthCm !== null && p.t >= last - 6 * 3600);
    return {
      line: filled.map(draw).join(""),
      area: filled.map((r) => `${draw(r)}L${x(r.at(-1)?.t ?? 0).toFixed(1)},${base}L${x(r[0]?.t ?? 0).toFixed(1)},${base}Z`).join(""),
      freshLine: fresh && recent.length > 1 ? draw(recent) : "",
    };
    // `x` and `y` are derived from first, last and top.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [series, fresh, first, last, top]);

  const days = useMemo(() => {
    const out: number[] = [];
    const midnight = new Date(last * 1000);
    midnight.setHours(0, 0, 0, 0);
    for (let t = midnight.getTime() / 1000; t > first; t -= DAY_S) out.push(t);
    return out.reverse();
  }, [first, last]);

  const at = (e: PointerEvent<SVGSVGElement>): void => {
    const box = e.currentTarget.getBoundingClientRect();
    const t = first + (((e.clientX - box.left) / box.width) * W - PAD.left) / (W - PAD.left - PAD.right) * (last - first);
    let best: number | null = null;
    series.forEach((p, i) => {
      if (p.depthCm !== null && (best === null || Math.abs(p.t - t) < Math.abs((series[best]?.t ?? 0) - t))) best = i;
    });
    setHover(best);
  };

  // The arrow keys read the week the way the pointer does: about three hours per press, skipping gaps in the data.
  const keyStep = Math.max(1, Math.round(series.length / 56));
  const readingFrom = (i: number, dir: 1 | -1): number | null => {
    for (let j = Math.min(series.length - 1, Math.max(0, i)); j >= 0 && j < series.length; j += dir) if (series[j]?.depthCm != null) return j;
    return null;
  };
  const latest = series.findLastIndex((p) => p.depthCm !== null);
  const onKey = (e: KeyboardEvent<SVGSVGElement>): void => {
    const from = hover ?? latest;
    const next = e.key === "ArrowLeft" ? readingFrom(from - keyStep, -1) : e.key === "ArrowRight" ? readingFrom(from + keyStep, 1) : e.key === "Home" ? readingFrom(0, 1) : e.key === "End" ? readingFrom(series.length - 1, -1) : undefined;
    if (next === undefined) return;
    e.preventDefault();
    if (next !== null) setHover(next);
  };

  const shown = hover !== null ? series[hover] : series[latest];
  const spoken = shown?.depthCm != null ? `${hover === null ? "latest" : stamp(shown.t)}, ${shown.depthCm.toFixed(shown.depthCm < 10 ? 1 : 0)} centimetres of snow` : "no readings";
  return (
    <div className="weather-chart">
      <div className="weather-chart__read num">
        <span>{shown ? (hover === null ? "Latest" : stamp(shown.t)) : "No readings"}</span>
        <b>{shown?.depthCm != null ? `${shown.depthCm.toFixed(shown.depthCm < 10 ? 1 : 0)} cm` : "–"}</b>
      </div>
      <svg
        className="weather-chart__svg"
        viewBox={`0 0 ${W} ${H}`}
        role="slider"
        tabIndex={0}
        aria-label="Snow depth over the last seven days. Left and right arrow keys read another time."
        aria-valuemin={0}
        aria-valuemax={Math.max(0, series.length - 1)}
        aria-valuenow={hover ?? Math.max(0, latest)}
        aria-valuetext={spoken}
        onPointerMove={at}
        onPointerLeave={() => setHover(null)}
        onKeyDown={onKey}
        onFocus={() => setHover((h) => h ?? (latest >= 0 ? latest : null))}
        onBlur={() => setHover(null)}
      >
        <defs>
          <linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--bone)" stopOpacity="0.38" />
            <stop offset="1" stopColor="var(--bone)" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {[0, top / 2, top].map((v) => (
          <g key={v}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)} className="weather-chart__grid" />
            <text x={PAD.left - 5} y={y(v) + 3} textAnchor="end" className="weather-chart__label">
              {v}
            </text>
          </g>
        ))}
        {days.map((t) => (
          <g key={t}>
            <line x1={x(t)} x2={x(t)} y1={PAD.top} y2={base} className="weather-chart__day" />
            <text x={x(t) + 3} y={H - 4} className="weather-chart__label">
              {new Date(t * 1000).toLocaleDateString("en-GB", { weekday: "short" })}
            </text>
          </g>
        ))}
        {area && <path d={area} fill={`url(#${gradient})`} />}
        {line && (
          <motion.path
            d={line}
            className="weather-chart__line"
            initial={reduced ? false : { pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ type: "spring", duration: 0.9, bounce: 0 }}
          />
        )}
        {freshLine && <path d={freshLine} className="weather-chart__fresh" />}
        {hover !== null && series[hover]?.depthCm != null && (
          <g>
            <line x1={x(series[hover]?.t ?? 0)} x2={x(series[hover]?.t ?? 0)} y1={PAD.top} y2={base} className="weather-chart__rule" />
            <circle cx={x(series[hover]?.t ?? 0)} cy={y(series[hover]?.depthCm ?? 0)} r="3" className="weather-chart__dot" />
          </g>
        )}
      </svg>
    </div>
  );
}
