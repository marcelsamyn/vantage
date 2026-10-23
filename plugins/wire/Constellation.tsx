import { motion } from "motion/react";
import { Laptop } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { usePrefersReducedMotion, useScreenActive } from "../../app/core/hooks";
import type { OrgNode } from "./model";

interface Placed {
  node: OrgNode;
  x: number;
  y: number;
  r: number;
  order: number;
  /** Show the name without hovering. */
  labelled: boolean;
}

interface CountryArc {
  id: string;
  path: string;
  labelX: number;
  labelY: number;
  text: string;
}

const ARC_SCALE = 1.17;
const LABEL_SCALE = 1.3;
const GROUP_GAP = 0.9;

const radiusFor = (connections: number): number => 7 + Math.min(14, Math.sqrt(connections) * 2.4);
const clip = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/**
 * Put this Mac at the centre and every organisation on an ellipse around it, grouped by country. Busy countries
 * come first, clockwise from the top. On a crowded ring every other node sits closer in so labels do not collide.
 */
function arrange(nodes: OrgNode[], w: number, h: number): { placed: Placed[]; arcs: CountryArc[]; rx: number; ry: number } {
  const cx = w / 2;
  const cy = h / 2;
  const rx = (w / 2 - 36) / LABEL_SCALE;
  const ry = (h / 2 - 30) / LABEL_SCALE;
  const at = (angle: number, scale: number): readonly [number, number] => [cx + rx * scale * Math.cos(angle), cy + ry * scale * Math.sin(angle)];

  const groups: { code: string; country: string; members: OrgNode[] }[] = [];
  for (const n of nodes) {
    const code = n.countryCode ?? "??";
    const last = groups[groups.length - 1];
    if (last && last.code === code) last.members.push(n);
    else groups.push({ code, country: n.country, members: [n] });
  }

  const slots = nodes.length + groups.length * GROUP_GAP;
  const unit = (Math.PI * 2) / Math.max(slots, 1);
  const crowded = nodes.length > 12;
  const labelLimit = w < 560 ? 5 : 24;
  const biggest = new Set(
    [...nodes]
      .sort((a, b) => b.connections - a.connections)
      .slice(0, labelLimit)
      .map((n) => n.id),
  );

  const placed: Placed[] = [];
  const arcs: CountryArc[] = [];
  let cursor = -Math.PI / 2 + (GROUP_GAP / 2) * unit;
  let n = 0;
  for (const g of groups) {
    const start = cursor;
    for (const node of g.members) {
      const angle = cursor + unit / 2;
      const [x, y] = at(angle, crowded && n % 2 === 1 ? 0.78 : 1);
      placed.push({ node, x, y, r: radiusFor(node.connections), order: n, labelled: biggest.has(node.id) });
      n++;
      cursor += unit;
    }
    const end = cursor;
    const steps = Math.max(2, Math.ceil(((end - start) / (Math.PI * 2)) * 80));
    const path = Array.from({ length: steps + 1 }, (_, i) => {
      const [x, y] = at(start + ((end - start) * i) / steps, ARC_SCALE);
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    }).join("");
    const [labelX, labelY] = at((start + end) / 2, LABEL_SCALE);
    const wide = (end - start) / (Math.PI * 2) > 0.14 && w >= 560;
    arcs.push({ id: g.code, path, labelX, labelY, text: g.code === "??" ? "NOT LOCATED" : wide ? `${g.code} · ${g.country.toUpperCase()}` : g.code });
    cursor += GROUP_GAP * unit;
  }
  return { placed, arcs, rx, ry };
}

/**
 * Radial map of where this Mac's connections go: one disc per organisation, sized by how many connections it holds,
 * grouped by country. Click a disc to open its profile.
 */
export function Constellation({
  nodes,
  total,
  activeApp,
  onOpen,
}: {
  nodes: OrgNode[];
  total: number;
  activeApp: string | null;
  onOpen: (node: OrgNode) => void;
}): ReactElement {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 720, h: 520 });
  const [hovered, setHovered] = useState<string | null>(null);
  // After the first paint, nodes move without the entrance stagger.
  const entered = useRef(false);
  useEffect(() => {
    entered.current = true;
  }, []);
  const reduced = usePrefersReducedMotion();
  const active = useScreenActive();

  // Measured before the first paint, so the picture appears at its real size instead of jumping to it.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = (): void => {
      const w = Math.max(300, el.clientWidth);
      setSize({ w, h: w < 560 ? 520 : w < 900 ? 500 : 540 });
    };
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    fit();
    return () => ro.disconnect();
  }, []);

  const { placed, arcs, rx, ry } = useMemo(() => arrange(nodes, size.w, size.h), [nodes, size]);
  const cx = size.w / 2;
  const cy = size.h / 2;
  const focus = hovered !== null || activeApp !== null;
  const lit = (n: OrgNode): boolean => (hovered !== null ? n.id === hovered : activeApp !== null ? n.apps.has(activeApp) : true);

  return (
    <div className={`wire-constellation${active && !reduced ? " wire-constellation--live" : ""}`} ref={box}>
      <svg width={size.w} height={size.h} role="group" aria-label={`Map of ${nodes.length} organisations your Mac is connected to`}>
        <ellipse cx={cx} cy={cy} rx={rx} ry={ry} className="wire-orbit" />
        <ellipse cx={cx} cy={cy} rx={rx * 0.42} ry={ry * 0.42} className="wire-orbit wire-orbit--inner" />

        {arcs.map((a) => (
          <g key={a.id} className="wire-country">
            <path d={a.path} />
            <text x={a.labelX} y={a.labelY} textAnchor="middle" dominantBaseline="middle">
              {a.text}
            </text>
          </g>
        ))}

        {placed.map((p) => (
          <motion.line
            key={`link-${p.node.id}`}
            x1={cx}
            y1={cy}
            x2={p.x}
            y2={p.y}
            className={`wire-link${focus ? (lit(p.node) ? " wire-link--lit" : " wire-link--dim") : ""}`}
            initial={reduced ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.5, delay: 0.25 + p.order * 0.04 }}
          />
        ))}

        <g transform={`translate(${cx} ${cy})`}>
          <circle r={44} className="wire-self__pulse" />
          <circle r={30} className="wire-self__disc" />
          <Laptop x={-11} y={-11} width={22} height={22} strokeWidth={1.6} className="wire-self__icon" />
          <text y={52} textAnchor="middle" className="wire-self__name">
            This Mac
          </text>
          {size.w >= 560 && (
            <text y={65} textAnchor="middle" className="wire-node__sub">
              {total} {total === 1 ? "connection" : "connections"}
            </text>
          )}
        </g>

        {placed.map((p) => {
          const isLit = lit(p.node);
          const isHovered = hovered === p.node.id;
          const showName = (p.labelled && !focus) || (focus && isLit) || isHovered;
          return (
            <motion.g
              key={p.node.id}
              className={`wire-node${focus && !isLit ? " wire-node--dim" : ""}${isHovered ? " wire-node--hover" : ""}`}
              role="button"
              tabIndex={0}
              aria-label={`${p.node.label}, ${p.node.country}, ${p.node.connections} ${p.node.connections === 1 ? "connection" : "connections"}`}
              initial={reduced ? false : { x: cx, y: cy, opacity: 0, scale: 0.4 }}
              animate={{ x: p.x, y: p.y, opacity: 1, scale: 1 }}
              transition={{ type: "spring", duration: 0.7, bounce: 0, delay: reduced || entered.current ? 0 : 0.15 + p.order * 0.05 }}
              onPointerEnter={() => setHovered(p.node.id)}
              onPointerLeave={() => setHovered(null)}
              onFocus={() => setHovered(p.node.id)}
              onBlur={() => setHovered(null)}
              onClick={() => onOpen(p.node)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onOpen(p.node);
                }
              }}
            >
              {/* The invisible hit circle is at least a fingertip wide, however small the node. */}
              <circle r={Math.max(p.r + 10, 22)} fill="transparent" />
              <circle r={p.r + 5} className="wire-node__halo" />
              <circle r={p.r} className="wire-node__disc" />
              {p.r >= 12 && (
                <text y={4} textAnchor="middle" className="wire-node__count">
                  {p.node.connections}
                </text>
              )}
              {showName && (
                <text y={p.r + 15} textAnchor="middle" className="wire-node__name">
                  {clip(p.node.label, 20)}
                </text>
              )}
              {isHovered && (
                <text y={p.r + 28} textAnchor="middle" className="wire-node__sub">
                  {p.node.hosts.length} {p.node.hosts.length === 1 ? "address" : "addresses"}
                </text>
              )}
            </motion.g>
          );
        })}
      </svg>
    </div>
  );
}
