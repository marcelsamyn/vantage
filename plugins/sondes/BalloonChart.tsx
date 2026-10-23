import { motion } from "motion/react";
import type { ReactElement } from "react";
import * as SunCalc from "suncalc";
import { fmt } from "../../app/core/format";
import { usePrefersReducedMotion } from "../../app/core/hooks";
import type { Units } from "../../app/core/settings";
import { altitudeLabel } from "./client";
import type { TrackPoint } from "./types";
import "./sondes.css";

const W = 300;
const H = 92;
const PAD = 4;
const EARTH_RADIUS_M = 6_371_000;

/** Is the sun above the horizon as seen from a balloon at this height? A high balloon sees past the ground horizon, so the sun sets later for it. */
export function sunlit(at: number, lat: number, lon: number, altM: number): boolean {
  const dip = Math.acos(EARTH_RADIUS_M / (EARTH_RADIUS_M + Math.max(0, altM)));
  return SunCalc.getPosition(new Date(at), lat, lon).altitude > -dip;
}

/**
 * Altitude over the last three days, with the night shaded. Solar-powered balloons sink or rise with the sun,
 * so the shape of the line follows the shape of the day.
 */
export function BalloonChart({ track, units }: { track: readonly TrackPoint[]; units: Units }): ReactElement | null {
  const reduced = usePrefersReducedMotion();
  const first = track[0];
  const last = track[track.length - 1];
  if (!first || !last || track.length < 3 || last.at <= first.at) return null;

  const alts = track.map((p) => p.altM);
  const lo = Math.min(...alts);
  const hi = Math.max(...alts);
  const span = Math.max(hi - lo, 400);
  const bottom = lo - span * 0.15;
  const top = hi + span * 0.15;
  const x = (at: number): number => PAD + ((at - first.at) / (last.at - first.at)) * (W - PAD * 2);
  const y = (alt: number): number => H - PAD - ((alt - bottom) / (top - bottom)) * (H - PAD * 2);
  const line = track.map((p, i) => `${i ? "L" : "M"}${x(p.at).toFixed(1)},${y(p.altM).toFixed(1)}`).join("");

  // Night bands: each stretch between two fixes is judged at its midpoint.
  const nights: { x0: number; x1: number }[] = [];
  for (let i = 1; i < track.length; i++) {
    const a = track[i - 1] as TrackPoint;
    const b = track[i] as TrackPoint;
    if (sunlit((a.at + b.at) / 2, (a.lat + b.lat) / 2, (a.lon + b.lon) / 2, (a.altM + b.altM) / 2)) continue;
    const prev = nights[nights.length - 1];
    if (prev && Math.abs(prev.x1 - x(a.at)) < 0.5) prev.x1 = x(b.at);
    else nights.push({ x0: x(a.at), x1: x(b.at) });
  }

  return (
    <figure className="sondes-flight sondes-balloon-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Altitude since ${fmt.ago(first.at)}, between ${altitudeLabel(lo, units)} and ${altitudeLabel(hi, units)}. Shaded stretches are night.`}>
        {nights.map((n) => (
          <rect key={n.x0} x={n.x0} y={PAD} width={Math.max(1, n.x1 - n.x0)} height={H - PAD * 2} className="sondes-balloon-chart__night" />
        ))}
        {[0.25, 0.5, 0.75].map((f) => (
          <line key={f} x1={PAD} x2={W - PAD} y1={H * f} y2={H * f} className="sondes-flight__grid" />
        ))}
        <motion.path
          d={line}
          className="sondes-flight__line sondes-balloon-chart__line"
          initial={reduced ? false : { pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ type: "spring", duration: 1.1, bounce: 0 }}
        />
        <circle cx={x(last.at)} cy={y(last.altM)} r={3.4} className="sondes-flight__now" />
      </svg>
      <figcaption className="num">
        <span>{fmt.ago(first.at)}</span>
        <span>
          {altitudeLabel(lo, units)} to {altitudeLabel(hi, units)}
        </span>
        <span>{fmt.clock(last.at)}</span>
      </figcaption>
    </figure>
  );
}
