import { motion } from "motion/react";
import { useEffect, useRef, type ReactElement } from "react";
import { useAmbientMotion, usePrefersReducedMotion } from "../../app/core/hooks";
import type { BandReach, IonosphereInfo } from "./types";

const W = 320;
const H = 124;
const PAD_X = 12;
const GROUND_Y = 100;
const R = 6371;
/** The picture spans the furthest landing plus a margin, within these limits. One bounce reaches about 4,100 km. */
const MIN_SPAN_KM = 2400;
const MAX_SPAN_KM = 4400;
/** A band that bounces from straight overhead lands on top of the transmitter; draw it a little way off so the ray reads as a ray. */
const OVERHEAD_LANDING_KM = 150;
/** Elevation of the ray drawn for a band that passes through the layer. */
const ESCAPE_ELEVATION = (62 * Math.PI) / 180;
const MIN_LABEL_GAP = 27;

/**
 * The ionosphere seen from the side, to scale: Earth's curve, the F2 layer at its measured height, and the path of
 * a signal from the transmitter for every band that bounces. Rays are straight lines, drawn with the secant law
 * the server used for the landing distances. The first band that passes through draws as a dashed ray into space.
 */
export function SkyMirror({ info }: { info: IonosphereInfo }): ReactElement {
  const reduced = usePrefersReducedMotion();
  // The travelling pulses are SMIL animations, an ambient loop: the SVG timeline pauses at rest and keeps its phase.
  const ambient = useAmbientMotion();
  const svg = useRef<SVGSVGElement>(null);
  useEffect(() => {
    if (ambient) svg.current?.unpauseAnimations();
    else svg.current?.pauseAnimations();
  }, [ambient]);
  const { hmF2, name } = info.main;
  const open = info.bands.filter((b) => b.state !== "closed");
  const landingKm = (b: BandReach): number => (b.state === "near" ? OVERHEAD_LANDING_KM : b.fromKm);
  const spanKm = Math.min(MAX_SPAN_KM, Math.max(MIN_SPAN_KM, Math.ceil((Math.max(0, ...open.map(landingKm)) * 1.2) / 100) * 100));
  const thetaSpan = spanKm / R;
  const thetaMid = thetaSpan / 2;
  // Polar to flat: angle measured from the middle of the picture, so the Earth bulges upward and the picture stays low.
  const flat = (theta: number, rho: number): { x: number; y: number } => ({ x: rho * Math.sin(theta - thetaMid), y: rho * Math.cos(theta - thetaMid) - R * Math.cos(thetaMid) });
  const xMax = (R + hmF2) * Math.sin(thetaMid);
  const scale = (W - 2 * PAD_X) / (2 * xMax);
  const px = (p: { x: number; y: number }): [number, number] => [PAD_X + (p.x + xMax) * scale, GROUND_Y - p.y * scale];
  const at = (theta: number, rho: number): string => px(flat(theta, rho)).map((n) => n.toFixed(1)).join(",");

  const arc = (rho: number): string => {
    const steps = 48;
    let d = "";
    for (let i = 0; i <= steps; i++) d += `${i === 0 ? "M" : "L"}${at((i / steps) * thetaSpan, rho)}`;
    return d;
  };
  const earth = `${arc(R)}L${W},${H}L0,${H}Z`;

  const rays = open.map((b) => {
    const land = landingKm(b) / R;
    return { band: b, d: `M${at(0, R)}L${at(land / 2, R + hmF2)}L${at(land, R)}`, landing: px(flat(land, R)) };
  });

  const [tx, ty] = px(flat(0, R));
  const escaping = info.bands.find((b) => b.state === "closed");
  const up = { x: -Math.sin(thetaMid), y: Math.cos(thetaMid) };
  const along = { x: Math.cos(thetaMid), y: Math.sin(thetaMid) };
  const dir = { x: along.x * Math.cos(ESCAPE_ELEVATION) + up.x * Math.sin(ESCAPE_ELEVATION), y: along.y * Math.cos(ESCAPE_ELEVATION) + up.y * Math.sin(ESCAPE_ELEVATION) };
  const reachTop = (ty - 6) / (dir.y * scale);
  const escapeEnd: [number, number] = [tx + dir.x * scale * reachTop, ty - dir.y * scale * reachTop];

  let lastLabelX = -Infinity;
  const labels = rays.filter((r) => r.band.state === "skip").map((r) => {
    const [lx] = r.landing;
    const show = lx - lastLabelX >= MIN_LABEL_GAP;
    if (show) lastLabelX = lx;
    return { ...r, show };
  });

  return (
    <svg ref={svg} className="spacewx-mirror" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Side view of the ionosphere above ${name}: ${open.length} of ${info.bands.length} shortwave bands bounce off the layer ${Math.round(hmF2)} kilometres up`}>
      <defs>
        <linearGradient id="spacewx-mirror-ground" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--raise)" />
          <stop offset="1" stopColor="var(--deep)" />
        </linearGradient>
      </defs>
      <path d={arc(R + hmF2)} className="spacewx-mirror__layer" />
      <text x={PAD_X} y={12} className="spacewx-mirror__tag">
        F2 layer · {Math.round(hmF2)} km up
      </text>
      <path d={earth} fill="url(#spacewx-mirror-ground)" className="spacewx-mirror__earth" />

      {escaping && (
        <g>
          <line x1={tx} y1={ty} x2={escapeEnd[0]} y2={escapeEnd[1]} className="spacewx-mirror__escape" />
          <text x={Math.min(W - PAD_X, escapeEnd[0] + 6)} y={Math.max(24, escapeEnd[1] + 14)} className="spacewx-mirror__tag" textAnchor={escapeEnd[0] > W - 120 ? "end" : "start"}>
            {escaping.name} and up escape
          </text>
        </g>
      )}

      {rays.map(({ band, d }, i) => (
        <motion.path
          key={band.name}
          d={d}
          className="spacewx-mirror__ray"
          style={{ opacity: 0.4 + 0.6 * (band.mhz / (open[open.length - 1]?.mhz ?? band.mhz)) }}
          initial={reduced ? false : { pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ type: "spring", duration: 0.8, bounce: 0, delay: 0.1 + i * 0.07 }}
        />
      ))}
      {!reduced &&
        rays.map(({ band, d }, i) => (
          <circle key={band.name} r={1.8} className="spacewx-mirror__pulse">
            <animateMotion dur="2.6s" begin={`${(i * 0.37).toFixed(2)}s`} repeatCount="indefinite" path={d} />
          </circle>
        ))}

      {labels.map(({ band, landing, show }) => (
        <g key={band.name}>
          <circle cx={landing[0]} cy={landing[1]} r={2} className="spacewx-mirror__landing" />
          {show && (
            <text x={landing[0]} y={GROUND_Y + 15} className="spacewx-mirror__band" textAnchor="middle">
              {band.name}
            </text>
          )}
        </g>
      ))}

      <circle cx={tx} cy={ty} r={3.2} className="spacewx-mirror__tx" />
      <text x={tx} y={GROUND_Y + 15} className="spacewx-mirror__band spacewx-mirror__band--tx" textAnchor="start">
        {name}
      </text>
    </svg>
  );
}
