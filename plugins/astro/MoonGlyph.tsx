import type { ReactElement } from "react";

/**
 * The Moon as it looks tonight. `phase` follows SunCalc: 0 new, 0.25 first quarter, 0.5 full, 0.75 last quarter.
 * The lit part is a semicircle on the lit side closed by the terminator, an ellipse whose width follows the phase.
 */
export function MoonGlyph({ phase, size = 64 }: { phase: number; size?: number }): ReactElement {
  const r = size / 2 - 1;
  const waxing = phase < 0.5;
  const k = Math.cos(2 * Math.PI * phase);
  const rx = Math.abs(k) * r;
  const lit = `M0,${-r} A${r},${r} 0 0,${waxing ? 1 : 0} 0,${r} A${rx},${r} 0 0,${(k > 0) === waxing ? 0 : 1} 0,${-r}Z`;
  return (
    <svg width={size} height={size} viewBox={`${-size / 2} ${-size / 2} ${size} ${size}`} aria-hidden>
      <circle r={r} fill="rgba(226,234,240,0.06)" stroke="var(--line-strong)" />
      <path d={lit} fill="var(--bone)" />
    </svg>
  );
}
