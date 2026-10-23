import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { fmt } from "../../app/core/format";
import { Meter, Readout, Stat } from "../../app/ui";
import type { MixGroup, PowerMix } from "./types";

/** Colours by meaning: renewables in shades of mint, nuclear in ice, fossil in greys. */
const INK: Record<MixGroup, { fill: string; opacity: number }> = {
  solar: { fill: "var(--mint)", opacity: 0.95 },
  wind: { fill: "var(--mint)", opacity: 0.62 },
  hydro: { fill: "var(--mint)", opacity: 0.38 },
  bio: { fill: "var(--mint)", opacity: 0.22 },
  geothermal: { fill: "var(--mint)", opacity: 0.13 },
  nuclear: { fill: "var(--ice)", opacity: 0.6 },
  gas: { fill: "var(--fog)", opacity: 0.55 },
  coal: { fill: "var(--ash)", opacity: 0.9 },
  oil: { fill: "var(--ash)", opacity: 0.6 },
  storage: { fill: "var(--bone)", opacity: 0.2 },
  other: { fill: "var(--bone)", opacity: 0.1 },
};

const H = 220;
const PAD = { left: 40, right: 8, top: 20, bottom: 22 };

/** Generation by source over the last day, stacked, with the renewable share and CO2 estimate at the chosen time. */
export function Mix({ mix, countryName }: { mix: PowerMix; countryName: string }): ReactElement {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const last = mix.t.length - 1;
  const [hover, setHover] = useState<number | null>(null);
  const at = hover === null ? last : Math.min(hover, last);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(Math.max(240, el.clientWidth)));
    setWidth(Math.max(240, el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const geometry = useMemo(() => {
    const n = mix.t.length;
    const totals = mix.t.map((_, i) => mix.series.reduce((s, g) => s + (g.mw[i] ?? 0), 0));
    const peak = Math.max(1000, ...totals);
    const top = Math.ceil(peak / 5000) * 5000;
    const pw = width - PAD.left - PAD.right;
    const ph = H - PAD.top - PAD.bottom;
    const x = (i: number): number => PAD.left + (n <= 1 ? 0 : (i / (n - 1)) * pw);
    const y = (mw: number): number => PAD.top + ph - (mw / top) * ph;
    const base = new Array<number>(n).fill(0);
    const layers = mix.series.map((s) => {
      const lower = [...base];
      s.mw.forEach((v, i) => {
        base[i] = (base[i] ?? 0) + v;
      });
      const upper = [...base];
      const d = `${upper.map((u, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(u).toFixed(1)}`).join("")}${lower
        .map((l, i) => `L${x(n - 1 - i).toFixed(1)},${y(lower[n - 1 - i] ?? 0).toFixed(1)}`)
        .join("")}Z`;
      return { id: s.id, d };
    });
    const grid = Array.from({ length: top / 5000 + 1 }, (_, k) => k * 5000);
    return { layers, grid, x, y, top, pw, ph };
  }, [mix, width]);

  const shareAt = mix.renewableShare[at];
  const co2At = mix.co2[at];
  const loadAt = mix.load[at];
  const sources = mix.series.map((s) => ({ s, mw: s.mw[at] ?? 0 })).sort((a, b) => b.mw - a.mw);
  const total = sources.reduce((sum, r) => sum + r.mw, 0);
  const ticks = mix.t.flatMap((t, i) => (new Date(t * 1000).getMinutes() === 0 && new Date(t * 1000).getHours() % 6 === 0 ? [{ t, i }] : []));
  const pointer = (clientX: number, rect: DOMRect): void => {
    const f = (clientX - rect.left - PAD.left) / geometry.pw;
    setHover(Math.max(0, Math.min(last, Math.round(f * last))));
  };

  return (
    <div className="power-mix">
      <div className="power-mix__stats">
        <Stat label={`Renewable share of generation · ${hover === null ? "latest" : fmt.clock((mix.t[at] ?? 0) * 1000)}`} value={shareAt != null ? shareAt.toFixed(0) : "—"} unit="%" tone="mint" size="lg" />
        <Stat label="CO₂ of the mix, estimated" value={co2At != null ? fmt.int(co2At) : "—"} unit="g / kWh" size="lg" hint="Lifecycle emissions per source (IPCC), weighted by what is generating" />
        <Stat label="Demand" value={loadAt != null ? fmt.one(loadAt / 1000) : "—"} unit="GW" size="lg" hint={`${countryName}, reported by the grid operator`} />
      </div>

      <div ref={box} className="power-chart" onPointerLeave={() => setHover(null)}>
        <svg
          width={width}
          height={H}
          viewBox={`0 0 ${width} ${H}`}
          role="img"
          aria-label={`Stacked area chart of electricity generation in ${countryName} over the last 26 hours`}
          onPointerMove={(e) => pointer(e.clientX, e.currentTarget.getBoundingClientRect())}
        >
          {geometry.grid.map((mw) => (
            <g key={mw}>
              <line x1={PAD.left} x2={width - PAD.right} y1={geometry.y(mw)} y2={geometry.y(mw)} className="power-chart__grid" />
              <text x={PAD.left - 6} y={geometry.y(mw)} className="power-chart__label" textAnchor="end" dominantBaseline="middle">
                {mw / 1000}
              </text>
            </g>
          ))}
          <text x={PAD.left - 6} y={6} className="power-chart__label" textAnchor="end">
            GW
          </text>
          {geometry.layers.map((l) => (
            <path key={l.id} d={l.d} fill={INK[l.id].fill} fillOpacity={INK[l.id].opacity} className="power-chart__layer" />
          ))}
          {ticks.map(({ t, i }) => (
            <text key={t} x={geometry.x(i)} y={H - 6} className="power-chart__label" textAnchor="middle">
              {new Date(t * 1000).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
            </text>
          ))}
          <line x1={geometry.x(at)} x2={geometry.x(at)} y1={PAD.top} y2={PAD.top + geometry.ph} className="power-chart__cursor" />
        </svg>
      </div>

      <div className="power-mix__legend">
        {sources.map(({ s, mw }) => (
          <div key={s.id} className="power-mix__row">
            <span className="power-mix__swatch" style={{ background: INK[s.id].fill, opacity: Math.max(0.35, INK[s.id].opacity) }} />
            <span className="power-mix__name">{s.label}</span>
            <span className="num power-mix__mw">{mw >= 1000 ? `${fmt.one(mw / 1000)} GW` : `${fmt.int(mw)} MW`}</span>
            <span className="power-mix__bar">
              <Meter value={total > 0 ? mw / total : 0} tone={s.renewable ? "mint" : "var(--fog)"} />
            </span>
          </div>
        ))}
      </div>

      <Readout rows={[["Shown", `The last ${Math.round(((mix.t[last] ?? 0) - (mix.t[0] ?? 0)) / 3600)} hours, a reading ${mix.stepS >= 3600 ? "every hour" : "every 15 minutes"}, newest at ${fmt.clock((mix.t[last] ?? 0) * 1000)}`]]} />
    </div>
  );
}
