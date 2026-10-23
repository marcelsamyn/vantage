import { useEffect, useId, useRef, useState, type ReactElement } from "react";
import { usePrefersReducedMotion, useScreenActive } from "../../app/core/hooks";
import { drawDish, easeAzimuth, viewBoxFor } from "./dish";

export type DishState = "live" | "pointed" | "idle";

interface Pose {
  az: number;
  el: number;
}

/** Seconds the pose takes to close most of the gap: a heavy antenna starts and stops gently. */
const SLEW_TIME_CONSTANT = 0.28;
const SETTLED_DEG = 0.04;
/** A change smaller than this is a dish tracking its spacecraft: too small to see, so the pose snaps instead of slewing. */
const SNAP_DEG = 1.5;

/**
 * Eases the drawn pose toward the reported pose. A dish that first appears starts stowed at the zenith and rises
 * to its pointing, after `delayMs`, so a screen of many dishes wakes up one by one.
 */
function useEasedPose(target: Pose, delayMs: number): Pose {
  const reduced = usePrefersReducedMotion();
  const screenActive = useScreenActive();
  const [pose, setPose] = useState<Pose>(() => (reduced ? target : { az: target.az, el: 90 }));
  const current = useRef(pose);

  useEffect(() => {
    const from = current.current;
    const small = Math.abs(target.el - from.el) < SNAP_DEG && Math.abs(((target.az - from.az + 540) % 360) - 180) < SNAP_DEG;
    if (reduced || !screenActive || small) {
      current.current = target;
      setPose(target);
      return;
    }
    let raf = 0;
    const begin = performance.now() + delayMs;
    let last = performance.now();
    const step = (now: number): void => {
      if (now < begin) {
        raf = requestAnimationFrame(step);
        return;
      }
      const dt = Math.min(0.1, (now - Math.max(last, begin)) / 1000);
      last = now;
      const k = 1 - Math.exp(-dt / SLEW_TIME_CONSTANT);
      const from = current.current;
      const next: Pose = { az: easeAzimuth(from.az, target.az, k), el: from.el + (target.el - from.el) * k };
      const settled = Math.abs(next.el - target.el) < SETTLED_DEG && Math.abs(((next.az - target.az + 540) % 360) - 180) < SETTLED_DEG;
      current.current = settled ? target : next;
      setPose(current.current);
      if (!settled) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    // The delay only matters for the first rise; later targets move at once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target.az, target.el, reduced, screenActive]);

  return pose;
}

/**
 * One antenna in real pose: tower, yoke, bowl and feed, standing in a compass ring so its azimuth can be read off.
 * While signals flow, dotted pulses run in along the line of sight for downlink and dashes run out for uplink.
 */
export function DishArt({
  name,
  sizeM,
  azimuthDeg,
  elevationDeg,
  state,
  downlink,
  uplink,
  delayMs = 0,
}: {
  name: string;
  sizeM: number;
  azimuthDeg: number;
  elevationDeg: number;
  state: DishState;
  downlink: boolean;
  uplink: boolean;
  delayMs?: number;
}): ReactElement {
  const pose = useEasedPose({ az: azimuthDeg, el: elevationDeg }, delayMs);
  const art = drawDish(sizeM, pose.az, pose.el);
  const id = useId();
  const [dx, dy] = art.beams.axis[0];
  const [ex, ey] = art.beams.axis[1];
  const fadeDown = `${id}-down`;
  const fadeUp = `${id}-up`;
  const paused = !useScreenActive();

  return (
    <svg
      className={`deepspace-art deepspace-art--${state}${paused ? " deepspace-art--paused" : ""}`}
      viewBox={viewBoxFor(sizeM)}
      role="img"
      aria-label={`${name}, a ${sizeM} metre dish, facing azimuth ${Math.round(azimuthDeg)} degrees, elevation ${Math.round(elevationDeg)} degrees`}
    >
      <defs>
        <linearGradient id={fadeDown} gradientUnits="userSpaceOnUse" x1={dx} y1={dy} x2={ex} y2={ey}>
          <stop offset="0" stopColor="var(--sodium)" stopOpacity="1" />
          <stop offset="1" stopColor="var(--sodium)" stopOpacity="0" />
        </linearGradient>
        <linearGradient id={fadeUp} gradientUnits="userSpaceOnUse" x1={dx} y1={dy} x2={ex} y2={ey}>
          <stop offset="0" stopColor="var(--bone)" stopOpacity="0.9" />
          <stop offset="1" stopColor="var(--bone)" stopOpacity="0" />
        </linearGradient>
      </defs>

      <ellipse className="deepspace-art__ring" cx={art.ring.cx} cy={art.ring.cy} rx={art.ring.rx} ry={art.ring.ry} />
      {art.ticks.map((t, i) => (
        <line key={i} className={t.cardinal ? "deepspace-art__tick deepspace-art__tick--major" : "deepspace-art__tick"} x1={t.from[0]} y1={t.from[1]} x2={t.to[0]} y2={t.to[1]} />
      ))}
      <text className="deepspace-art__north" x={art.north[0]} y={art.north[1]} textAnchor="middle" dominantBaseline="middle">
        N
      </text>
      <path className="deepspace-art__bearing" d={art.azimuthLine} />
      <circle className="deepspace-art__mark" cx={art.azimuthMark[0]} cy={art.azimuthMark[1]} r={2.6} />

      <path className="deepspace-art__frame" d={`${art.base}${art.tower}${art.yoke}`} />
      <path className="deepspace-art__hoop" d={`${art.hoops}${art.ribs}`} />
      <path className="deepspace-art__rim" d={art.rim} />
      <path className="deepspace-art__strut" d={art.struts} />
      <circle className="deepspace-art__feed" cx={art.feed[0]} cy={art.feed[1]} r={2.6} />

      {state === "pointed" && <line className="deepspace-beam deepspace-beam--wait" x1={dx} y1={dy} x2={ex} y2={ey} />}
      {downlink && <line className="deepspace-beam deepspace-beam--down" stroke={`url(#${fadeDown})`} x1={art.beams.down[0][0]} y1={art.beams.down[0][1]} x2={art.beams.down[1][0]} y2={art.beams.down[1][1]} />}
      {uplink && <line className="deepspace-beam deepspace-beam--up" stroke={`url(#${fadeUp})`} x1={art.beams.up[0][0]} y1={art.beams.up[0][1]} x2={art.beams.up[1][0]} y2={art.beams.up[1][1]} />}
    </svg>
  );
}
