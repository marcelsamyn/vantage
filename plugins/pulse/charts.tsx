import { useId, type ReactElement } from "react";
import { fmt } from "../../app/core/format";
import type { RiverStatus, RiverThresholds } from "./types";
import { levelText } from "./words";

const W = 320;
const H = 150;
const PAD = { l: 4, r: 4, t: 10, b: 20 };

const TONE: Record<RiverStatus, string> = { normal: "var(--mint)", elevated: "var(--sodium)", high: "var(--alarm)", unknown: "var(--ice)" };

interface Line {
  key: keyof RiverThresholds;
  label: string;
  colour: string;
  opacity: number;
}

const LINES: Line[] = [
  { key: "prewatch", label: "Pre-watch", colour: "var(--sodium)", opacity: 0.45 },
  { key: "watch", label: "Watch", colour: "var(--sodium)", opacity: 0.85 },
  { key: "prealarm", label: "Pre-alarm", colour: "var(--alarm)", opacity: 0.55 },
  { key: "alarm", label: "Alarm", colour: "var(--alarm)", opacity: 1 },
];

/**
 * A river level over time with the source's alert thresholds drawn across it. Thresholds always sit inside the
 * scale, so a flat line far below them shows how much room the river has left.
 */
export function LevelChart({ points, thresholds, status, now }: { points: readonly { at: number; level: number }[]; thresholds: RiverThresholds | null; status: RiverStatus; now: number }): ReactElement {
  const gradient = useId();
  const marks = thresholds ? LINES.flatMap((l) => (thresholds[l.key] === null ? [] : [{ ...l, value: thresholds[l.key] as number }])) : [];
  const values = [...points.map((p) => p.level), ...marks.map((m) => m.value)];
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const pad = Math.max(0.02, (hi - lo) * 0.08);
  const min = lo - pad;
  const max = hi + pad;
  const t0 = now - 48 * 3_600_000;
  const x = (t: number): number => PAD.l + ((t - t0) / (now - t0)) * (W - PAD.l - PAD.r);
  const y = (v: number): number => PAD.t + (1 - (v - min) / (max - min)) * (H - PAD.t - PAD.b);
  const line = points.map((p, i) => `${i ? "L" : "M"}${x(p.at).toFixed(1)},${y(p.level).toFixed(1)}`).join("");
  const first = points[0];
  const last = points[points.length - 1];
  const tone = TONE[status];
  return (
    <svg className="pulse-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="River level over the last 48 hours">
      <defs>
        <linearGradient id={gradient} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor={tone} stopOpacity="0.3" />
          <stop offset="1" stopColor={tone} stopOpacity="0" />
        </linearGradient>
      </defs>
      {[0, 24, 48].map((h) => (
        <g key={h}>
          <line x1={x(t0 + h * 3_600_000)} x2={x(t0 + h * 3_600_000)} y1={PAD.t} y2={H - PAD.b} stroke="var(--line)" />
          <text x={Math.min(W - 18, Math.max(2, x(t0 + h * 3_600_000) - (h === 0 ? 0 : h === 48 ? 22 : 14)))} y={H - 5} className="pulse-chart__tick">
            {h === 48 ? "now" : `-${48 - h} h`}
          </text>
        </g>
      ))}
      {marks.map((m) => (
        <g key={m.key}>
          <line x1={PAD.l} x2={W - PAD.r} y1={y(m.value)} y2={y(m.value)} stroke={m.colour} strokeOpacity={m.opacity} strokeDasharray="4 3" />
          <text x={PAD.l + 2} y={y(m.value) - 3} className="pulse-chart__label" fill={m.colour} fillOpacity={Math.max(0.7, m.opacity)}>
            {m.label} {levelText(m.value)}
          </text>
        </g>
      ))}
      {points.length > 1 && first && last && (
        <>
          <path d={`${line}L${x(last.at).toFixed(1)},${H - PAD.b}L${x(first.at).toFixed(1)},${H - PAD.b}Z`} fill={`url(#${gradient})`} />
          <path d={line} fill="none" stroke={tone} strokeWidth="1.5" strokeLinejoin="round" />
        </>
      )}
      {last && <circle cx={x(last.at)} cy={y(last.level)} r="3" fill={tone} stroke="var(--void)" strokeWidth="1.5" />}
      <text x={W - PAD.r} y={PAD.t - 1} textAnchor="end" className="pulse-chart__tick">
        {last ? `${levelText(last.level)} · ${fmt.ago(last.at, now)}` : ""}
      </text>
    </svg>
  );
}
