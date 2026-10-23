import { motion } from "motion/react";
import { Camera, CircleHelp, Gamepad2, Laptop, Lightbulb, Printer, Router, Smartphone, Speaker, Tablet, Tv, type LucideIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { usePrefersReducedMotion } from "../../app/core/hooks";
import { profile, useIsProfiled } from "../../app/core/profile";
import { KIND_LABEL, KIND_ORDER, deviceTitle } from "./labels";
import type { DeviceKind, NetDevice } from "./types";

const ICONS: Record<DeviceKind, LucideIcon> = {
  router: Router,
  computer: Laptop,
  phone: Smartphone,
  tablet: Tablet,
  tv: Tv,
  speaker: Speaker,
  printer: Printer,
  camera: Camera,
  console: Gamepad2,
  iot: Lightbulb,
  unknown: CircleHelp,
};

interface Placed {
  device: NetDevice;
  x: number;
  y: number;
  /** Order of appearance, for the staggered entrance. */
  order: number;
}

interface GroupArc {
  kind: DeviceKind;
  path: string;
  labelX: number;
  labelY: number;
}

const ARC_SCALE = 1.16;
const LABEL_SCALE = 1.29;
const GROUP_GAP = 0.7;

/**
 * Place this Mac at the centre, the router on an inner ring and everything else around an outer ring, grouped by
 * kind. Radii are ellipses sized to the container so the picture fills wide and tall screens alike.
 */
function arrange(devices: NetDevice[], w: number, h: number): { placed: Placed[]; arcs: GroupArc[]; rx: number; ry: number } {
  const cx = w / 2;
  const cy = h / 2;
  const rx = (w / 2 - 28) / LABEL_SCALE;
  const ry = (h / 2 - 24) / LABEL_SCALE;
  const at = (angle: number, scale: number): readonly [number, number] => [cx + rx * scale * Math.cos(angle), cy + ry * scale * Math.sin(angle)];

  const placed: Placed[] = [];
  const mac = devices.find((d) => d.isThisMac);
  const gateway = devices.find((d) => d.isGateway && !d.isThisMac);
  if (mac) placed.push({ device: mac, x: cx, y: cy, order: 0 });
  if (gateway) placed.push({ device: gateway, x: cx, y: cy - ry * 0.52, order: 1 });

  const others = devices
    .filter((d) => d !== mac && d !== gateway)
    .sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.ip.localeCompare(b.ip, "en", { numeric: true }));

  const groups: { kind: DeviceKind; members: NetDevice[] }[] = [];
  for (const d of others) {
    const last = groups[groups.length - 1];
    if (last && last.kind === d.kind) last.members.push(d);
    else groups.push({ kind: d.kind, members: [d] });
  }
  const slots = others.length + groups.length * GROUP_GAP;
  const crowded = others.length > 12;
  const arcs: GroupArc[] = [];
  let cursor = -Math.PI / 2 + (GROUP_GAP / 2 / Math.max(slots, 1)) * Math.PI * 2;
  let n = 0;
  for (const g of groups) {
    const start = cursor;
    for (const d of g.members) {
      const angle = cursor + (0.5 / Math.max(slots, 1)) * Math.PI * 2;
      // On a crowded ring every other node sits closer in so labels do not collide.
      const scale = crowded && n % 2 === 1 ? 0.8 : 1;
      const [x, y] = at(angle, scale);
      placed.push({ device: d, x, y, order: 2 + n++ });
      cursor += (1 / Math.max(slots, 1)) * Math.PI * 2;
    }
    const end = cursor;
    const steps = Math.max(2, Math.ceil(((end - start) / (Math.PI * 2)) * 60));
    const path = Array.from({ length: steps + 1 }, (_, i) => {
      const [x, y] = at(start + ((end - start) * i) / steps, ARC_SCALE);
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    }).join("");
    const [labelX, labelY] = at((start + end) / 2, LABEL_SCALE);
    arcs.push({ kind: g.kind, path, labelX, labelY });
    cursor += (GROUP_GAP / Math.max(slots, 1)) * Math.PI * 2;
  }
  return { placed, arcs, rx, ry };
}

const clip = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function Node({ p, cx, cy, hovered, anyHovered, onHover }: { p: Placed; cx: number; cy: number; hovered: boolean; anyHovered: boolean; onHover: (id: string | null) => void }): ReactElement {
  const d = p.device;
  const reduced = usePrefersReducedMotion();
  const selected = useIsProfiled("device", d.id);
  const Icon = ICONS[d.kind];
  const big = d.isThisMac || d.isGateway;
  const r = d.isThisMac ? 26 : big ? 22 : 18;
  const open = (): void => profile.open({ kind: "device", id: d.id, data: d });
  const classes = ["net-node", d.isThisMac && "net-node--self", d.isGateway && "net-node--gateway", d.randomized && "net-node--private", hovered && "net-node--hover", selected && "net-node--selected", anyHovered && !hovered && "net-node--dim"]
    .filter(Boolean)
    .join(" ");

  return (
    <motion.g
      className={classes}
      role="button"
      tabIndex={0}
      aria-label={`${deviceTitle(d)}, ${KIND_LABEL[d.kind]}, ${d.ip}`}
      initial={reduced ? false : { x: cx, y: cy, opacity: 0, scale: 0.4 }}
      animate={{ x: p.x, y: p.y, opacity: 1, scale: 1 }}
      transition={{ type: "spring", duration: 0.7, bounce: 0, delay: reduced ? 0 : 0.15 + p.order * 0.05 }}
      onPointerEnter={() => onHover(d.id)}
      onPointerLeave={() => onHover(null)}
      onFocus={() => onHover(d.id)}
      onBlur={() => onHover(null)}
      onClick={open}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          open();
        }
      }}
    >
      {d.isThisMac && <circle r={r + 10} className="net-node__pulse" />}
      <circle r={r + 8} fill="transparent" />
      <circle r={r} className="net-node__disc" />
      <Icon x={-r * 0.46} y={-r * 0.46} width={r * 0.92} height={r * 0.92} strokeWidth={1.6} className="net-node__icon" />
      <text y={d.isGateway ? -r - 17 : r + 15} textAnchor="middle" className="net-node__name">
        {clip(d.isThisMac ? "This Mac" : deviceTitle(d), 18)}
      </text>
      {!d.isThisMac && (
        <text y={d.isGateway ? -r - 5 : r + 27} textAnchor="middle" className="net-node__sub">
          {hovered ? d.ip : KIND_LABEL[d.kind].toLowerCase()}
        </text>
      )}
    </motion.g>
  );
}

/** Radial map of the local network. Click a node to open its profile. */
export function Constellation({ devices, hovered, onHover }: { devices: NetDevice[]; hovered: string | null; onHover: (id: string | null) => void }): ReactElement {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 720, h: 480 });
  const reduced = usePrefersReducedMotion();

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = (): void => {
      const w = Math.max(300, el.clientWidth);
      setSize({ w, h: w < 560 ? 540 : w < 900 ? 500 : 520 });
    };
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    fit();
    return () => ro.disconnect();
  }, []);

  const { placed, arcs, rx, ry } = useMemo(() => arrange(devices, size.w, size.h), [devices, size]);
  const cx = size.w / 2;
  const cy = size.h / 2;
  const mac = placed.find((p) => p.device.isThisMac);
  const router = placed.find((p) => p.device.isGateway);
  const hub = router ?? mac;

  return (
    <div className="net-constellation" ref={box}>
      <svg width={size.w} height={size.h} role="group" aria-label={`Map of ${devices.length} devices on your network`}>
        <ellipse cx={cx} cy={cy} rx={rx} ry={ry} className="net-orbit" />
        <ellipse cx={cx} cy={cy} rx={rx * 0.42} ry={ry * 0.42} className="net-orbit net-orbit--inner" />

        {arcs.map((a) => (
          <g key={a.kind + a.path.length} className="net-arc">
            <path d={a.path} />
            <text x={a.labelX} y={a.labelY} textAnchor="middle" dominantBaseline="middle">
              {KIND_LABEL[a.kind]}
            </text>
          </g>
        ))}

        {mac && router && (
          <motion.line x1={mac.x} y1={mac.y} x2={router.x} y2={router.y} className="net-link net-link--core" initial={reduced ? false : { pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.6, delay: 0.2 }} />
        )}
        {hub &&
          placed
            .filter((p) => p !== mac && p !== router)
            .map((p) => (
              <motion.line
                key={p.device.id}
                x1={hub.x}
                y1={hub.y}
                x2={p.x}
                y2={p.y}
                className={`net-link${hovered === p.device.id ? " net-link--hover" : ""}`}
                initial={reduced ? false : { pathLength: 0, opacity: 0 }}
                animate={{ pathLength: 1, opacity: 1 }}
                transition={{ duration: 0.5, delay: 0.3 + p.order * 0.05 }}
              />
            ))}

        {placed.map((p) => (
          <Node key={p.device.id} p={p} cx={cx} cy={cy} hovered={hovered === p.device.id} anyHovered={hovered !== null} onHover={onHover} />
        ))}
      </svg>
    </div>
  );
}
