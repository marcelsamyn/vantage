import { motion } from "motion/react";
import { useId, type ReactElement } from "react";
import { usePrefersReducedMotion } from "../../app/core/hooks";
import type { Tone } from "../../app/ui";

const W = 160;

/**
 * A small line chart. `values` run left to right; gaps (null) are skipped.
 * `guides` draw faint horizontal lines at chosen values, e.g. zero or flare-class thresholds.
 */
export function Trace({ values, min, max, tone = "sodium", height = 32, guides = [] }: { values: readonly (number | null)[]; min: number; max: number; tone?: Tone; height?: number; guides?: readonly number[] }): ReactElement {
  const reduced = usePrefersReducedMotion();
  const clipId = `trace${useId().replace(/:/g, "")}`;
  const span = Math.max(1e-9, max - min);
  const y = (v: number): number => height - 1.5 - ((Math.min(max, Math.max(min, v)) - min) / span) * (height - 3);
  const n = Math.max(2, values.length);
  let d = "";
  values.forEach((v, i) => {
    if (v === null) return;
    d += `${d === "" || values[i - 1] === null ? "M" : "L"}${((i / (n - 1)) * W).toFixed(1)},${y(v).toFixed(1)}`;
  });
  return (
    <svg className="spacewx-trace" viewBox={`0 0 ${W} ${height}`} width="100%" height={height} preserveAspectRatio="none" aria-hidden>
      {guides.filter((g) => g >= min && g <= max).map((g) => (
        <line key={g} x1={0} x2={W} y1={y(g)} y2={y(g)} className="spacewx-trace__guide" vectorEffect="non-scaling-stroke" />
      ))}
      {d && (
        <>
          <defs>
            <clipPath id={clipId}>
              <motion.rect x={0} y={-2} height={height + 4} initial={reduced ? false : { width: 0 }} animate={{ width: W }} transition={{ type: "spring", duration: 0.9, bounce: 0 }} />
            </clipPath>
          </defs>
          <path d={d} fill="none" stroke={`var(--${tone})`} strokeWidth={1.4} strokeLinejoin="round" vectorEffect="non-scaling-stroke" clipPath={`url(#${clipId})`} />
        </>
      )}
    </svg>
  );
}
