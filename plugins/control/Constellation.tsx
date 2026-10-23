import { AnimatePresence, motion } from "motion/react";
import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactElement } from "react";
import { useAnimationFrame, usePrefersReducedMotion, useScreenActive } from "../../app/core/hooks";
import { capabilityOf, LOW_SUPPLY_PERCENT, useControl } from "./client";
import { KIND } from "./kinds";
import type { Device } from "./types";

/**
 * The hero: this Mac at the centre and every device around it. Devices VANTAGE talks to directly sit on the inner
 * ring, grouped by kind; devices behind a bridge sit on the outer ring in their bridge's sector, grouped by room.
 * A pulse runs along the links whenever an action goes out.
 */

type Point = [number, number];

interface Placed {
  device: Device;
  x: number;
  y: number;
  r: number;
  parent: Placed | null;
  order: number;
  /** The link from the parent: an SVG path, and points along it for a pulse to follow. */
  link: { d: string; points: Point[] } | null;
}

interface GroupArc {
  label: string;
  path: string;
  x: number;
  y: number;
  anchor: "start" | "middle" | "end";
}

/** Group arcs sit just outside the outer ring of devices. */
const ARC_RING = 1.1;
const deg = (d: number): number => (d * Math.PI) / 180;

function cubic(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
  const u = 1 - t;
  const along = (i: 0 | 1): number => u * u * u * p0[i] + 3 * u * u * t * p1[i] + 3 * u * t * t * p2[i] + t * t * t * p3[i];
  return [along(0), along(1)];
}

function layout(devices: readonly Device[], w: number, h: number): { center: Placed | null; placed: Placed[]; arcs: GroupArc[]; rx: number; ry: number; inner: number } {
  const cx = w / 2;
  const cy = h / 2;
  // Room at the sides for group labels on wide screens. On a phone the labels are hidden and nodes are smaller.
  const compact = w < 560;
  const rx = (w / 2 - (compact ? 30 : 104)) / ARC_RING;
  const ry = (h / 2 - 40) / (ARC_RING + 0.04);
  const at = (angle: number, ring: number): Point => [cx + rx * ring * Math.cos(deg(angle)), cy + ry * ring * Math.sin(deg(angle))];

  const mac = devices.find((d) => d.kind === "computer" && d.local);
  const center: Placed | null = mac ? { device: mac, x: cx, y: cy, r: compact ? 24 : 30, parent: null, order: 0, link: null } : null;
  const others = devices.filter((d) => d !== mac);
  const ids = new Set(others.map((d) => d.id));
  const childrenOf = new Map<string, Device[]>();
  for (const d of others) if (d.via && ids.has(d.via)) childrenOf.set(d.via, [...(childrenOf.get(d.via) ?? []), d]);
  for (const list of childrenOf.values()) list.sort((a, b) => a.group.localeCompare(b.group) || a.name.localeCompare(b.name));
  const direct = others
    .filter((d) => !d.via || !ids.has(d.via))
    .sort((a, b) => Number(b.local) - Number(a.local) || a.group.localeCompare(b.group) || a.name.localeCompare(b.name));

  const nested = childrenOf.size > 0;
  // With few devices there is room for larger nodes.
  const roomy = others.length <= 8 && !compact;
  const inner = nested ? (compact ? 0.62 : 0.56) : 0.78;
  const weight = (d: Device): number => Math.max(1, childrenOf.get(d.id)?.length ?? 0);
  const total = Math.max(1, direct.reduce((n, d) => n + weight(d), 0));

  const placed: Placed[] = [];
  const slots: { label: string; from: number; to: number }[] = [];
  // The first sector is centred on the left, so two devices sit left and right of this Mac on a wide screen.
  let cursor = (h > w ? -90 : 180) - ((direct[0] ? weight(direct[0]) : 1) / total) * 180;
  let order = 1;
  for (const d of direct) {
    const span = (weight(d) / total) * 360;
    const angle = cursor + span / 2;
    const [x, y] = at(angle, inner);
    const hub: Placed = { device: d, x, y, r: roomy ? 24 : compact ? 17 : 20, parent: center, order: order++, link: { d: `M${cx},${cy}L${x},${y}`, points: [[cx, cy], [x, y]] } };
    placed.push(hub);
    const children = childrenOf.get(d.id) ?? [];
    if (children.length === 0) slots.push({ label: d.group, from: cursor, to: cursor + span });
    children.forEach((child, i) => {
      const a = cursor + ((i + 0.5) * span) / children.length;
      // On a crowded ring every other node steps inwards so names do not collide.
      const ring = children.length > 12 && i % 2 ? 0.9 : 1;
      const end = at(a, ring);
      // A radial-tree curve: out from the bridge along its own bearing, then round to the device, never across the centre.
      const c1 = at(angle, (inner + ring) / 2);
      const c2 = at(a, (inner + ring) / 2);
      const points = Array.from({ length: 13 }, (_, k) => cubic([x, y], c1, c2, end, k / 12));
      placed.push({ device: child, x: end[0], y: end[1], r: roomy ? 18 : compact ? 13 : 15, parent: hub, order: order++, link: { d: `M${x},${y}C${c1.join(",")} ${c2.join(",")} ${end.join(",")}`, points } });
      slots.push({ label: child.group, from: cursor + (i * span) / children.length, to: cursor + ((i + 1) * span) / children.length });
    });
    cursor += span;
  }

  // Neighbouring slots with the same label become one arc: "Printers", "Living room".
  const merged: { label: string; from: number; to: number }[] = [];
  for (const s of slots) {
    const last = merged[merged.length - 1];
    if (last && last.label === s.label && Math.abs(last.to - s.from) < 0.01) last.to = s.to;
    else merged.push({ ...s });
  }
  const arcRing = nested ? ARC_RING : inner + 0.24;
  const arcs = merged
    .filter((m) => m.to - m.from >= 14)
    .map((m): GroupArc => {
      const pad = Math.min(6, (m.to - m.from) / 6);
      const from = m.from + pad;
      const to = m.to - pad;
      const steps = Math.max(2, Math.ceil((to - from) / 4));
      const path = Array.from({ length: steps + 1 }, (_, i) => {
        const [x, y] = at(from + ((to - from) * i) / steps, arcRing);
        return `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`;
      }).join("");
      // The label sits just outside the arc, reading away from the centre on the left and right.
      const mid = (from + to) / 2;
      const [x, y] = at(mid, arcRing + 0.06);
      const side = Math.cos(deg(mid));
      const anchor: GroupArc["anchor"] = side < -0.35 ? "end" : side > 0.35 ? "start" : "middle";
      // Side labels sit a line above the horizontal so the major tick at the side does not run through them.
      return { label: m.label, path, x: x + (anchor === "end" ? -4 : anchor === "start" ? 4 : 0), y: anchor === "middle" ? y : y - 10, anchor };
    });
  return { center, placed, arcs, rx, ry, inner };
}

const clip = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** One short line under a node's name, from its capabilities. */
function summary(device: Device, children: number): string {
  if (!device.online) return "not answering";
  if (device.pairing && !device.pairing.paired) return device.pairing.action === "Pair" ? "not paired" : "needs permission";
  const media = capabilityOf(device, "media");
  if (media) return media.state;
  const supplies = capabilityOf(device, "supplies")?.supplies.filter((s) => s.percent !== null);
  if (supplies?.length) {
    const low = supplies.reduce((a, b) => ((b.percent ?? 100) < (a.percent ?? 100) ? b : a));
    return `${low.name} ${low.percent} %`;
  }
  const power = capabilityOf(device, "switch", "power");
  const level = capabilityOf(device, "level");
  if (power) return power.on ? `on${level ? ` · ${level.value} %` : ""}` : "off";
  if (children) return `${children} device${children === 1 ? "" : "s"}`;
  const choice = capabilityOf(device, "choice");
  if (choice) return `${choice.options.length} ready`;
  return KIND[device.kind].label.toLowerCase();
}

/** Four survey-corner brackets around a selected node: the lock-on. */
function reticle(r: number): string {
  const k = r * 0.42;
  return [`M${-r},${-r + k}V${-r}H${-r + k}`, `M${r - k},${-r}H${r}V${-r + k}`, `M${r},${r - k}V${r}H${r - k}`, `M${-r + k},${r}H${-r}V${r - k}`].join("");
}

function NodeView({ p, childCount, hovered, dim, selected, onHover, onSelect, reduced, origin, compact }: { p: Placed; childCount: number; compact: boolean; hovered: boolean; dim: boolean; selected: boolean; onHover: (id: string | null) => void; onSelect: (id: string) => void; reduced: boolean; origin: Point }): ReactElement {
  const d = p.device;
  const Icon = KIND[d.kind].icon;
  const isCenter = p.parent === null;
  const power = capabilityOf(d, "switch", "power");
  const color = capabilityOf(d, "color")?.hex;
  const level = capabilityOf(d, "level");
  const media = capabilityOf(d, "media");
  const lowest = capabilityOf(d, "supplies")?.supplies.reduce<number | null>((min, s) => (s.percent === null ? min : min === null ? s.percent : Math.min(min, s.percent)), null);
  const lit = d.kind === "light" && d.online && power?.on;
  const unpaired = Boolean(d.pairing && !d.pairing.paired);
  const awake = isCenter && capabilityOf(d, "switch", "awake")?.on;
  // The level ring shows volume on this Mac and brightness on a light, but not for a light that is off.
  const levelShown = level && d.online && (!power || power.on);
  const classes = [
    "control-node",
    isCenter && "control-node--center",
    !d.online && "control-node--offline",
    unpaired && "control-node--unpaired",
    lit && "control-node--lit",
    media?.state === "playing" && "control-node--playing",
    hovered && "control-node--hover",
    selected && "control-node--selected",
    dim && "control-node--dim",
  ]
    .filter(Boolean)
    .join(" ");
  // A light glows in its own colour, as bright as it is set; white lights glow white.
  const glow = lit ? ({ "--glow": color ?? "var(--bone)", "--glow-opacity": String(0.15 + ((level?.value ?? 100) / 100) * 0.55) } as CSSProperties) : undefined;
  const select = (): void => onSelect(d.id);

  return (
    <motion.g
      className={classes}
      style={glow}
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      aria-label={`${d.name}, ${KIND[d.kind].label}, ${summary(d, childCount)}`}
      initial={reduced ? false : { x: origin[0], y: origin[1], opacity: 0, scale: 0.4 }}
      animate={{ x: p.x, y: p.y, opacity: 1, scale: 1 }}
      transition={{ type: "spring", duration: 0.7, bounce: 0, delay: reduced ? 0 : 0.1 + p.order * 0.05 }}
      onPointerEnter={() => onHover(d.id)}
      onPointerLeave={() => onHover(null)}
      onFocus={() => onHover(d.id)}
      onBlur={() => onHover(null)}
      onClick={select}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          select();
        }
      }}
    >
      <circle r={p.r + 10} fill="transparent" />
      {lit && <circle r={p.r + 12} className="control-node__glow" />}
      {isCenter && <circle r={p.r + 10} className="control-node__pulse" />}
      {awake && <circle r={p.r + 14} className="control-node__awake" />}
      {media?.state === "playing" && <circle r={p.r + 6} className="control-node__spin" />}
      <circle r={p.r} className="control-node__disc" />
      {level && levelShown && <circle r={p.r + 4} pathLength={1} className="control-node__level" style={{ strokeDasharray: `${level.value / 100} 1` }} transform="rotate(-90)" />}
      {lowest != null && <circle r={p.r + 4} pathLength={1} className={`control-node__level${lowest < LOW_SUPPLY_PERCENT ? " control-node__level--low" : ""}`} style={{ strokeDasharray: `${lowest / 100} 1` }} transform="rotate(-90)" />}
      <Icon x={-p.r * 0.45} y={-p.r * 0.45} width={p.r * 0.9} height={p.r * 0.9} strokeWidth={1.6} className="control-node__icon" />
      {selected && (
        <motion.path className="control-node__reticle" d={reticle(p.r + 7)} initial={reduced ? false : { scale: 1.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", duration: 0.35, bounce: 0 }} />
      )}
      {isCenter ? (
        <>
          {!compact && (
            <text y={p.r + 24} textAnchor="middle" className="control-node__eyebrow">
              This Mac
            </text>
          )}
          <text y={p.r + (compact ? 18 : 38)} textAnchor="middle" className="control-node__name">
            {clip(d.name, 22)}
          </text>
        </>
      ) : (
        <>
          <text y={p.r + 20} textAnchor="middle" className="control-node__name">
            {clip(d.name, compact ? 12 : 18)}
          </text>
          <text y={p.r + 32} textAnchor="middle" className="control-node__sub">
            {summary(d, childCount)}
          </text>
        </>
      )}
    </motion.g>
  );
}

export function Constellation({ devices, scanning }: { devices: readonly Device[]; scanning: boolean }): ReactElement {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 720, h: 460 });
  const [hovered, setHovered] = useState<string | null>(null);
  const reduced = usePrefersReducedMotion();
  const active = useScreenActive();
  const chosen = useControl((s) => s.selected);
  const select = useControl((s) => s.select);
  const pulses = useControl((s) => s.pulses);

  // Measured before the first paint, so the picture appears at its real size instead of jumping to it.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = (): void => setSize({ w: Math.max(300, el.clientWidth), h: Math.max(360, el.clientHeight) });
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    fit();
    return () => ro.disconnect();
  }, []);

  // The sweep turns slowly at rest and quickly while the network is being scanned. It is set straight on the
  // element each frame, so the rest of the picture does not re-render.
  const sweep = useRef<SVGGElement>(null);
  const sweepAngle = useRef(0);
  useAnimationFrame((dt) => {
    sweepAngle.current = (sweepAngle.current + dt * (scanning ? 150 : 36)) % 360;
    sweep.current?.setAttribute("transform", `rotate(${sweepAngle.current.toFixed(2)})`);
  }, active && !reduced);

  const { center, placed, arcs, rx, ry, inner } = useMemo(() => layout(devices, size.w, size.h), [devices, size]);
  // With nothing chosen, the panel beside the map shows this Mac, so the map marks it too.
  const selected = chosen ?? center?.device.id ?? null;
  const all = center ? [center, ...placed] : placed;
  const byId = new Map(all.map((p) => [p.device.id, p]));
  const countChildren = (id: string): number => placed.filter((p) => p.parent?.device.id === id).length;
  const cx = size.w / 2;
  const cy = size.h / 2;
  const focus = hovered ?? selected;
  const onPath = (p: Placed): boolean => {
    for (let n: Placed | null = focus ? (byId.get(focus) ?? null) : null; n; n = n.parent) if (n === p) return true;
    return false;
  };
  const wedge = `M0,0L${rx * Math.cos(deg(-36))},${rx * Math.sin(deg(-36))}A${rx},${rx} 0 0 1 ${rx},0Z`;

  return (
    <div className={`control-constellation${size.w < 560 ? " control-constellation--compact" : ""}`} ref={box}>
      <svg width={size.w} height={size.h} role="group" aria-label={`This Mac and ${placed.length} device${placed.length === 1 ? "" : "s"}`}>
        <defs>
          <linearGradient id="control-sweep-fill" gradientUnits="userSpaceOnUse" x1={rx * Math.cos(deg(-36))} y1={rx * Math.sin(deg(-36))} x2={rx} y2={0}>
            <stop offset="0" stopColor="var(--ice)" stopOpacity="0" />
            <stop offset="1" stopColor="var(--ice)" stopOpacity="0.16" />
          </linearGradient>
        </defs>

        {/* Survey rings and ticks */}
        <ellipse cx={cx} cy={cy} rx={rx * inner} ry={ry * inner} className="control-orbit" />
        {placed.some((p) => p.parent && p.parent !== center) && <ellipse cx={cx} cy={cy} rx={rx} ry={ry} className="control-orbit" />}
        <ellipse cx={cx} cy={cy} rx={rx * 0.24} ry={ry * 0.24} className="control-orbit control-orbit--core" />
        {Array.from({ length: 72 }, (_, i) => {
          const a = deg(i * 5);
          const major = i % 6 === 0;
          const r1 = major ? 1.25 : 1.225;
          return <line key={i} x1={cx + rx * 1.2 * Math.cos(a)} y1={cy + ry * 1.2 * Math.sin(a)} x2={cx + rx * r1 * Math.cos(a)} y2={cy + ry * r1 * Math.sin(a)} className={`control-tick${major ? " control-tick--major" : ""}`} />;
        })}
        <g transform={`translate(${cx} ${cy}) scale(1 ${ry / rx})`}>
          <g ref={sweep} className={`control-sweep${scanning ? " control-sweep--scanning" : ""}`}>
            <path d={wedge} fill="url(#control-sweep-fill)" />
            <line x1={0} y1={0} x2={rx} y2={0} className="control-sweep__edge" />
          </g>
        </g>

        {arcs.map((a) => (
          <g key={a.label + a.path} className="control-arc">
            <path d={a.path} />
            {/* On a phone there is no room beside the rings; the device panel names the group instead. */}
            {size.w >= 560 && (
              <text x={a.x} y={a.y} textAnchor={a.anchor} dominantBaseline="middle">
                {a.label}
              </text>
            )}
          </g>
        ))}

        {placed.map((p) =>
          p.link ? (
            <motion.path
              key={`link-${p.device.id}`}
              d={p.link.d}
              className={`control-link${p.device.local ? " control-link--local" : ""}${onPath(p) ? " control-link--focus" : ""}${!p.device.online ? " control-link--offline" : ""}`}
              initial={reduced ? false : { pathLength: 0, opacity: 0 }}
              animate={{ pathLength: 1, opacity: 1 }}
              transition={{ duration: 0.5, delay: 0.2 + p.order * 0.05 }}
            />
          ) : null,
        )}

        <AnimatePresence>
          {pulses.map((pulse) => {
            const target = byId.get(pulse.deviceId);
            if (!target) return null;
            // Follow every link from this Mac out to the device: through its bridge for a light.
            const route: Point[] = [];
            for (let n: Placed | null = target; n?.link; n = n.parent) route.unshift(...(route.length ? n.link.points.slice(0, -1) : n.link.points));
            const travel = reduced || pulse.failed || route.length < 2 ? 0 : 0.3 + 0.025 * route.length;
            return (
              <g key={pulse.id}>
                {travel > 0 && (
                  <motion.circle
                    r={3.5}
                    className="control-pulse"
                    initial={{ cx: route[0]?.[0] ?? cx, cy: route[0]?.[1] ?? cy, opacity: 1 }}
                    animate={{ cx: route.map((q) => q[0]), cy: route.map((q) => q[1]) }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: travel, ease: "easeInOut" }}
                  />
                )}
                <motion.circle
                  cx={target.x}
                  cy={target.y}
                  r={target.r}
                  className={`control-ping${pulse.failed ? " control-ping--failed" : ""}`}
                  initial={{ scale: 1, opacity: 0 }}
                  animate={{ scale: [1, 2.1], opacity: [0.9, 0] }}
                  transition={{ delay: travel, duration: 0.7, ease: "easeOut" }}
                  style={{ transformBox: "fill-box", transformOrigin: "center" }}
                />
              </g>
            );
          })}
        </AnimatePresence>

        {all.map((p) => (
          <NodeView
            key={p.device.id}
            p={p}
            childCount={countChildren(p.device.id)}
            hovered={hovered === p.device.id}
            dim={hovered !== null && !onPath(p)}
            selected={selected === p.device.id}
            onHover={setHovered}
            onSelect={select}
            reduced={reduced}
            origin={[cx, cy]}
            compact={size.w < 560}
          />
        ))}

        {placed.length === 0 && (
          <text x={cx} y={cy + 84} textAnchor="middle" className="control-node__sub">
            {scanning ? "looking for your devices…" : "nothing else found yet"}
          </text>
        )}
      </svg>
    </div>
  );
}
