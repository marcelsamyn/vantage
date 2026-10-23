import { motion } from "motion/react";
import { useEffect, useRef, useState, type ReactElement } from "react";
import { usePrefersReducedMotion } from "../../app/core/hooks";
import { LAYOUTS, strength, type Recommendation } from "./channels";
import { bandLabel } from "./labels";
import type { WifiBand, WifiNetwork } from "./types";

const HEIGHT = 196;
const PAD = { left: 38, right: 10, top: 22, bottom: 30 };
const DBM_RULES = [-40, -60, -80];

export interface ChartNetwork extends WifiNetwork {
  id: string;
  mine: boolean;
}

/** Rounded hump: a flat top with soft shoulders, spanning x0 to x1 in pixels. */
function humpPath(x0: number, x1: number, base: number, top: number): string {
  const r = Math.min((x1 - x0) * 0.28, 22);
  return `M${x0},${base} C${x0 + r},${base} ${x0 + r * 0.35},${top} ${x0 + r},${top} L${x1 - r},${top} C${x1 - r * 0.35},${top} ${x1 - r},${base} ${x1},${base} Z`;
}

/** One band of the classic Wi-Fi analyser chart: a hump per network, as wide as its channel and as tall as its signal. */
export function ChannelChart({
  band,
  networks,
  recommendation,
  hovered,
  onHover,
}: {
  band: WifiBand;
  networks: ChartNetwork[];
  recommendation: Recommendation | null;
  hovered: string | null;
  onHover: (id: string | null) => void;
}): ReactElement {
  const layout = LAYOUTS[band];
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const reduced = usePrefersReducedMotion();

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = (): void => setWidth(Math.max(320, el.clientWidth));
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    fit();
    return () => ro.disconnect();
  }, []);

  const plotW = width - PAD.left - PAD.right;
  const base = HEIGHT - PAD.bottom;
  const plotH = base - PAD.top;
  const [d0, d1] = layout.domain;
  const px = (x: number): number => PAD.left + ((x - d0) / (d1 - d0)) * plotW;
  const py = (dbm: number): number => base - strength(dbm) * plotH;
  // Skip labels when channels sit closer than a number is wide.
  const labelEvery = Math.max(1, Math.ceil(26 / (plotW / layout.ticks.length)));
  const ordered = [...networks].sort((a, b) => Number(a.mine) - Number(b.mine) || (a.signalDbm ?? -200) - (b.signalDbm ?? -200));

  return (
    <div className="net-chart" ref={box}>
      <div className="net-chart__head">
        <span className="v-eyebrow">{bandLabel(band)}</span>
        <span className="net-chart__count">
          {networks.length} {networks.length === 1 ? "network" : "networks"}
        </span>
      </div>
      <svg width={width} height={HEIGHT} role="img" aria-label={`${bandLabel(band)} channel map with ${networks.length} networks`}>
        {DBM_RULES.map((dbm) => (
          <g key={dbm}>
            <line x1={PAD.left} x2={width - PAD.right} y1={py(dbm)} y2={py(dbm)} className="net-chart__rule" />
            <text x={PAD.left - 6} y={py(dbm)} className="net-chart__axis" textAnchor="end" dominantBaseline="middle">
              {dbm}
            </text>
          </g>
        ))}
        <line x1={PAD.left} x2={width - PAD.right} y1={base} y2={base} className="net-chart__base" />

        {recommendation && (
          <rect
            x={px(recommendation.span[0]) + 1}
            y={base + 18}
            width={Math.max(4, px(recommendation.span[1]) - px(recommendation.span[0]) - 2)}
            height={3}
            rx={1.5}
            className="net-chart__best"
          />
        )}

        {layout.ticks.map((t, i) => (
          <text key={t.channel} x={px(t.x)} y={base + 13} textAnchor="middle" className="net-chart__tick">
            {i % labelEvery === 0 ? t.channel : ""}
          </text>
        ))}

        {ordered.map((n, i) => {
          const [x0, x1] = layout.span(n.channel, n.widthMhz);
          const left = px(x0) + 1;
          const right = px(x1) - 1;
          const known = n.signalDbm !== null;
          const top = known ? py(n.signalDbm ?? -90) : base - plotH * 0.4;
          const active = hovered === n.id;
          const dim = hovered !== null && !active && !n.mine;
          const label = n.mine ? (n.ssid ?? "Your network") : n.ssid;
          const classes = ["net-hump", n.mine && "net-hump--mine", !known && "net-hump--unknown", active && "net-hump--active", dim && "net-hump--dim"].filter(Boolean).join(" ");
          return (
            <motion.g
              key={n.id}
              className={classes}
              style={{ transformBox: "fill-box", transformOrigin: "50% 100%" }}
              initial={reduced ? false : { scaleY: 0, opacity: 0 }}
              animate={{ scaleY: 1, opacity: 1 }}
              transition={{ type: "spring", duration: 0.55, bounce: 0, delay: reduced ? 0 : i * 0.045 }}
              onPointerEnter={() => onHover(n.id)}
              onPointerLeave={() => onHover(null)}
            >
              <path d={humpPath(left, right, base, top)} className="net-hump__body" />
              {label && (
                <text x={(left + right) / 2} y={top - 6} textAnchor="middle" className="net-hump__label">
                  {label}
                </text>
              )}
            </motion.g>
          );
        })}
        {networks.length === 0 && (
          <text x={width / 2} y={HEIGHT / 2} textAnchor="middle" className="net-chart__axis">
            No networks seen on this band
          </text>
        )}
      </svg>
    </div>
  );
}
