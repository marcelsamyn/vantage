import type { ReactElement } from "react";
import { fmt } from "../../app/core/format";
import type { Units } from "../../app/core/settings";
import { altitudeLabel } from "./client";
import type { Sonde, SondeTrack } from "./types";
import "./sondes.css";

const W = 300;
const H = 72;
const PAD = 4;

/** Altitude against time for one flight: the recorded part solid, the predicted part dashed, a dot where the balloon is now. */
export function FlightProfile({ sonde, track, now, units }: { sonde: Sonde; track: SondeTrack; now: number; units: Units }): ReactElement | null {
  const recorded = track.points;
  const lastRecorded = recorded[recorded.length - 1];
  if (!lastRecorded || recorded.length < 2) return null;
  const ahead = (sonde.prediction?.path ?? []).filter((p) => p.at > lastRecorded.at);
  const all = [...recorded.map((p) => ({ at: p.at, altM: p.altM })), ...ahead];
  const t0 = all[0]?.at ?? 0;
  const t1 = all[all.length - 1]?.at ?? t0 + 1;
  const top = Math.max(...all.map((p) => p.altM)) * 1.08;
  const x = (at: number): number => PAD + ((at - t0) / Math.max(1, t1 - t0)) * (W - PAD * 2);
  const y = (alt: number): number => H - PAD - (alt / top) * (H - PAD * 2);
  const line = (pts: { at: number; altM: number }[]): string => pts.map((p, i) => `${i ? "L" : "M"}${x(p.at).toFixed(1)},${y(p.altM).toFixed(1)}`).join("");
  const peak = all.reduce((best, p) => (p.altM > best.altM ? p : best), all[0] ?? lastRecorded);
  const marker = sonde.phase === "ground" || sonde.phase === "lost" ? lastRecorded : { at: Math.min(Math.max(now, t0), t1), altM: sonde.altM };

  return (
    <figure className="sondes-flight">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Flight profile: peak altitude ${altitudeLabel(peak.altM, units)}`}>
        {[0.25, 0.5, 0.75].map((f) => (
          <line key={f} x1={PAD} x2={W - PAD} y1={y(top * f)} y2={y(top * f)} className="sondes-flight__grid" />
        ))}
        <path d={`${line(recorded)}L${x(lastRecorded.at).toFixed(1)},${H - PAD}L${x(t0).toFixed(1)},${H - PAD}Z`} className="sondes-flight__area" />
        <path d={line(recorded)} className="sondes-flight__line" />
        {ahead.length > 0 && <path d={line([{ at: lastRecorded.at, altM: lastRecorded.altM }, ...ahead])} className="sondes-flight__line sondes-flight__line--predicted" />}
        <circle cx={x(peak.at)} cy={y(peak.altM)} r={2.2} className="sondes-flight__peak" />
        <circle cx={x(marker.at)} cy={y(marker.altM)} r={3.4} className="sondes-flight__now" />
      </svg>
      <figcaption className="num">
        <span>{fmt.clock(t0)}</span>
        <span>peak {altitudeLabel(peak.altM, units)}</span>
        <span>{fmt.clock(t1)}</span>
      </figcaption>
    </figure>
  );
}
