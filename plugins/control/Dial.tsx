import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactElement } from "react";

/**
 * A 0–100 dial: a 270° arc with survey ticks. Drag around it, or use the arrow keys.
 * The value is sent once, when the drag ends or the keys rest, so a device is not flooded with changes.
 */

const SIZE = 148;
const C = SIZE / 2;
const R = 54;
const START = 135;
const SWEEP = 270;
const KEY_SETTLE_MS = 350;

const polar = (deg: number, r: number): [number, number] => [C + r * Math.cos((deg * Math.PI) / 180), C + r * Math.sin((deg * Math.PI) / 180)];
const [ax, ay] = polar(START, R);
const [bx, by] = polar(START + SWEEP, R);
const ARC = `M${ax.toFixed(2)},${ay.toFixed(2)} A${R},${R} 0 1 1 ${bx.toFixed(2)},${by.toFixed(2)}`;
const TICKS = Array.from({ length: 28 }, (_, i) => {
  const major = i % 7 === 0 || i === 27;
  const deg = START + (SWEEP * i) / 27;
  const [x1, y1] = polar(deg, R + 9);
  const [x2, y2] = polar(deg, R + (major ? 15 : 12));
  return { x1, y1, x2, y2, major };
});

/** Pointer position to 0–100. The gap at the bottom snaps to the nearer end. */
function valueAt(e: PointerEvent<SVGSVGElement>): number {
  const box = e.currentTarget.getBoundingClientRect();
  const x = ((e.clientX - box.left) / box.width) * SIZE - C;
  const y = ((e.clientY - box.top) / box.height) * SIZE - C;
  const deg = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
  const rel = (deg - START + 360) % 360;
  if (rel > SWEEP) return rel > SWEEP + (360 - SWEEP) / 2 ? 0 : 100;
  return Math.round((rel / SWEEP) * 100);
}

export function Dial({ label, value, onCommit, disabled, unit = "%" }: { label: string; value: number; onCommit: (value: number) => void; disabled?: boolean; unit?: string }): ReactElement {
  const [local, setLocal] = useState(value);
  const [dragging, setDragging] = useState(false);
  const settle = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const release = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  /** True while arrow keys are still moving the dial. */
  const keying = useRef(false);
  /** The value sent to the device, until the device reports it back. */
  const sent = useRef<number | null>(null);
  const latest = useRef(value);
  latest.current = value;

  // Follow the device, except while the user turns the dial or a sent value has not come back yet.
  useEffect(() => {
    if (dragging || keying.current || (sent.current !== null && value !== sent.current)) return;
    sent.current = null;
    setLocal(value);
  }, [value, dragging]);
  useEffect(
    () => () => {
      clearTimeout(settle.current);
      clearTimeout(release.current);
    },
    [],
  );

  const commit = (v: number): void => {
    keying.current = false;
    if (v === latest.current) return;
    sent.current = v;
    onCommit(v);
    // If the device never reports the new value (the change failed), fall back to what it does report.
    clearTimeout(release.current);
    release.current = setTimeout(() => {
      sent.current = null;
      setLocal(latest.current);
    }, 4_000);
  };

  const onKey = (e: KeyboardEvent<SVGSVGElement>): void => {
    const step = { ArrowUp: 2, ArrowRight: 2, ArrowDown: -2, ArrowLeft: -2, PageUp: 10, PageDown: -10 }[e.key];
    let next: number | null = step === undefined ? null : Math.max(0, Math.min(100, local + step));
    if (e.key === "Home") next = 0;
    if (e.key === "End") next = 100;
    if (next === null) return;
    e.preventDefault();
    setLocal(next);
    keying.current = true;
    clearTimeout(settle.current);
    const settled = next;
    settle.current = setTimeout(() => commit(settled), KEY_SETTLE_MS);
  };

  const fraction = local / 100;
  const knobAngle = START + SWEEP * fraction;

  return (
    <svg
      className={`control-dial${dragging ? " control-dial--dragging" : ""}${disabled ? " control-dial--disabled" : ""}`}
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      width={SIZE}
      height={SIZE}
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={local}
      aria-valuetext={`${local}${unit === "%" ? " percent" : ` ${unit}`}`}
      aria-disabled={disabled || undefined}
      onKeyDown={disabled ? undefined : onKey}
      onPointerDown={(e) => {
        if (disabled) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        setDragging(true);
        setLocal(valueAt(e));
      }}
      onPointerMove={(e) => dragging && setLocal(valueAt(e))}
      onPointerUp={(e) => {
        if (!dragging) return;
        setDragging(false);
        commit(valueAt(e));
      }}
      onPointerCancel={() => setDragging(false)}
    >
      {TICKS.map((t, i) => (
        <line key={i} x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2} className={`control-dial__tick${t.major ? " control-dial__tick--major" : ""}${i / 27 <= fraction ? " control-dial__tick--lit" : ""}`} />
      ))}
      <path d={ARC} className="control-dial__track" />
      <path d={ARC} pathLength={1} className="control-dial__value" style={{ strokeDasharray: `${fraction} 1` }} />
      <g className="control-dial__knob" style={{ transform: `rotate(${knobAngle}deg)` }}>
        <circle cx={C + R} cy={C} r={5.5} />
      </g>
      <text x={C} y={C + 4} textAnchor="middle" className="control-dial__value-text">
        {local}
        <tspan className="control-dial__unit" dx={2}>
          {unit}
        </tspan>
      </text>
      <text x={C} y={C + 24} textAnchor="middle" className="control-dial__label">
        {label}
      </text>
    </svg>
  );
}
