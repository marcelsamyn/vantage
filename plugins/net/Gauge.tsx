import { motion, useMotionValue, useMotionValueEvent, useSpring, useTransform } from "motion/react";
import { useEffect, useRef, type ReactElement } from "react";
import { usePrefersReducedMotion } from "../../app/core/hooks";

const W = 420;
const H = 340;
const CX = W / 2;
const CY = 190;
const R = 150;
const START = 135;
const SWEEP = 270;
const MAJOR = [0, 1, 5, 10, 25, 50, 100, 250, 500, 1000];
const MINOR_STEPS = 54;

/** Gauge position for a rate: logarithmic, so 5 Mb/s and 500 Mb/s are both readable on one dial. */
const fraction = (mbps: number): number => Math.max(0, Math.min(1, Math.log10(1 + Math.max(0, mbps)) / 3));
const point = (deg: number, r: number): readonly [number, number] => [CX + r * Math.cos((deg * Math.PI) / 180), CY + r * Math.sin((deg * Math.PI) / 180)];

const ARC = (() => {
  const [x0, y0] = point(START, R);
  const [x1, y1] = point(START + SWEEP, R);
  return `M${x0.toFixed(2)},${y0.toFixed(2)} A${R},${R} 0 1 1 ${x1.toFixed(2)},${y1.toFixed(2)}`;
})();

const formatMbps = (v: number): string => (v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2));

/** Large arc gauge that eases toward the live rate. `value` is Mb/s; `caption` names what is measured. */
export function Gauge({ value, caption, unit = "Mb/s", display }: { value: number; caption: string; unit?: string; display?: string }): ReactElement {
  const reduced = usePrefersReducedMotion();
  const target = useMotionValue(0);
  const shown = useSpring(target, { stiffness: 90, damping: 20, mass: 0.9 });
  const frac = useTransform(shown, fraction);
  const knobX = useTransform(frac, (f) => point(START + f * SWEEP, R)[0]);
  const knobY = useTransform(frac, (f) => point(START + f * SWEEP, R)[1]);
  // A zero-length path still paints its round cap, so the arc fades in once there is something to show.
  const arcOpacity = useTransform(frac, (f) => (f > 0.004 ? 1 : 0));
  const text = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    target.set(value);
    if (reduced) shown.jump(value);
  }, [value, reduced, target, shown]);

  // The number is written straight into the DOM while the spring runs, so React never re-renders at 60 fps.
  useEffect(() => {
    if (text.current && display === undefined) text.current.textContent = formatMbps(Math.max(0, shown.get()));
  }, [display, shown]);

  useMotionValueEvent(shown, "change", (v) => {
    if (text.current && display === undefined) text.current.textContent = formatMbps(Math.max(0, v));
  });

  const minor = Array.from({ length: MINOR_STEPS + 1 }, (_, i) => START + (i / MINOR_STEPS) * SWEEP);

  return (
    <div className="net-gauge">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${caption}: ${display ?? formatMbps(value)} ${unit}`}>
        <defs>
          <filter id="net-gauge-glow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="5" />
          </filter>
        </defs>
        {minor.map((deg) => {
          const [x0, y0] = point(deg, R + 12);
          const [x1, y1] = point(deg, R + 18);
          return <line key={deg} x1={x0} y1={y0} x2={x1} y2={y1} className="net-gauge__minor" />;
        })}
        {MAJOR.map((m) => {
          const deg = START + fraction(m) * SWEEP;
          const [x0, y0] = point(deg, R + 10);
          const [x1, y1] = point(deg, R + 24);
          const [tx, ty] = point(deg, R + 38);
          return (
            <g key={m}>
              <line x1={x0} y1={y0} x2={x1} y2={y1} className="net-gauge__major" />
              <text x={tx} y={ty} textAnchor="middle" dominantBaseline="middle" className="net-gauge__label">
                {m}
              </text>
            </g>
          );
        })}
        <path d={ARC} className="net-gauge__track" />
        <motion.path d={ARC} className="net-gauge__glow" style={{ pathLength: frac, opacity: arcOpacity }} filter="url(#net-gauge-glow)" />
        <motion.path d={ARC} className="net-gauge__value" style={{ pathLength: frac, opacity: arcOpacity }} />
        <motion.circle r={6} className="net-gauge__knob" style={{ cx: knobX, cy: knobY }} />
        <motion.circle r={2.5} className="net-gauge__knob-core" style={{ cx: knobX, cy: knobY }} />
        <text x={CX} y={CY - 56} textAnchor="middle" className="net-gauge__caption">
          {caption}
        </text>
      </svg>
      <div className="net-gauge__readout">
        <span ref={text} className="display net-gauge__number">
          {display}
        </span>
        <span className="net-gauge__unit">{unit}</span>
      </div>
    </div>
  );
}
