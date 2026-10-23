import { Map as MapIcon } from "lucide-react";
import type { ReactElement } from "react";
import { fmt } from "../../app/core/format";
import { Button, Readout, Sparkline, Stat, Tag } from "../../app/ui";
import { showLayer } from "../city/client";
import { BORDER_CODE, powerWords } from "./client";
import type { BelgiumGrid, Border, BorderFlow } from "./types";

/** Where each neighbour sits on the diagram. It is a sketch, not a map: only the directions are true. */
const NODE: Record<Border | "Belgium", { x: number; y: number }> = {
  Belgium: { x: 215, y: 150 },
  Netherlands: { x: 255, y: 36 },
  Germany: { x: 388, y: 118 },
  Luxembourg: { x: 350, y: 250 },
  France: { x: 120, y: 258 },
  "United Kingdom": { x: 50, y: 62 },
};

const BORDER_ORDER: Border[] = ["Netherlands", "France", "Germany", "United Kingdom", "Luxembourg"];

/** Point on the way from `a` to `b`, `by` pixels from `a`. */
function along(a: { x: number; y: number }, b: { x: number; y: number }, by: number): { x: number; y: number } {
  const d = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  return { x: a.x + ((b.x - a.x) * by) / d, y: a.y + ((b.y - a.y) * by) / d };
}

function Diagram({ flows }: { flows: BorderFlow[] }): ReactElement {
  const be = NODE.Belgium;
  return (
    <svg viewBox="0 0 440 300" className="power-diagram" role="img" aria-label="Diagram of electricity flowing between Belgium and its neighbours">
      {BORDER_ORDER.map((border) => {
        const flow = flows.find((f) => f.border === border);
        const node = NODE[border];
        const exporting = (flow?.mw ?? 0) > 0;
        const from = along(exporting ? be : node, exporting ? node : be, exporting ? 34 : 24);
        const to = along(exporting ? node : be, exporting ? be : node, exporting ? 24 : 34);
        const width = flow ? 1.5 + Math.min(6, (Math.abs(flow.mw) / 3500) * 6) : 1;
        const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
        return (
          <g key={border} className={flow ? "power-diagram__link" : "power-diagram__link power-diagram__link--none"}>
            <line x1={be.x} y1={be.y} x2={node.x} y2={node.y} className="power-diagram__rail" />
            {flow && (
              <>
                <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} strokeWidth={width + 5} className="power-diagram__flow power-diagram__flow--halo" />
                <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} strokeWidth={width} className="power-diagram__flow" />
                <text x={mid.x} y={mid.y - 9} textAnchor="middle" className="power-diagram__mw">
                  {powerWords(flow.mw)}
                </text>
              </>
            )}
          </g>
        );
      })}
      {BORDER_ORDER.map((border) => (
        <g key={border} transform={`translate(${NODE[border].x} ${NODE[border].y})`}>
          <rect x={-34} y={-12} width={68} height={24} rx={2} className="power-diagram__node" />
          <text textAnchor="middle" dominantBaseline="middle" className="power-diagram__name">
            {BORDER_CODE[border]}
          </text>
        </g>
      ))}
      <g transform={`translate(${be.x} ${be.y})`}>
        <circle r={26} className="power-diagram__home" />
        <text textAnchor="middle" dominantBaseline="middle" className="power-diagram__name power-diagram__name--home">
          BE
        </text>
      </g>
    </svg>
  );
}

export function Belgium({ grid }: { grid: BelgiumGrid }): ReactElement {
  const ordered = BORDER_ORDER.flatMap((b) => grid.flows.filter((f) => f.border === b));
  const net = grid.flows.reduce((s, f) => s + f.mw, 0);
  const newest = Math.max(0, ...grid.flows.map((f) => f.at));
  const imb = grid.imbalance;
  const spread = imb ? Math.max(100, ...imb.series.map((p) => Math.abs(p.mw))) : 100;

  return (
    <div className="power-be">
      <div className="power-be__map">
        <Diagram flows={grid.flows} />
        <p className="power-fine">A sketch: only the directions are true. Thicker lines carry more power. Readings every 15 minutes, newest {newest ? fmt.clock(newest * 1000) : "—"}.</p>
      </div>

      <div className="power-be__side">
        <Stat
          label="Belgium, net across all borders"
          value={powerWords(net)}
          size="lg"
          hint={net < 0 ? "Belgium is importing" : "Belgium is exporting"}
          tone={net < 0 ? "ice" : "mint"}
        />
        <ul className="power-flows">
          {ordered.map((f) => (
            <li key={f.border} className="power-flows__row">
              <span className="power-flows__name">{f.border}</span>
              <Tag tone={f.mw < 0 ? "ice" : "mint"}>{f.mw < 0 ? "Imports" : "Exports"}</Tag>
              <span className="num power-flows__mw">{powerWords(f.mw)}</span>
              <span className="power-flows__spark">
                <Sparkline values={f.history.map((p) => Math.abs(p.mw))} tone={f.mw < 0 ? "ice" : "mint"} height={22} width={90} min={0} />
              </span>
            </li>
          ))}
        </ul>
        <Button size="sm" icon={<MapIcon size={13} />} onClick={() => showLayer("power.flows")}>
          Show flows on the map
        </Button>
      </div>

      {imb && (
        <div className="power-be__imbalance">
          <Stat label="System imbalance now" value={`${imb.mw >= 0 ? "+" : "−"}${fmt.int(Math.abs(imb.mw))}`} unit="MW" hint={imb.mw >= 0 ? "A surplus: more power fed in than used" : "A shortfall: more power used than fed in"} />
          <div className="power-be__imbalance-chart">
            <Sparkline values={imb.series.map((p) => p.mw)} min={-spread} max={spread} tone="sodium" height={48} width={300} fill={false} />
            <span className="power-be__zero" aria-hidden />
          </div>
          <Readout
            rows={[
              ["Last hour", `${imb.series.length} minute readings, newest ${fmt.clock(imb.at * 1000)}`],
              imb.ace !== null && ["Area control error", `${imb.ace >= 0 ? "+" : "−"}${fmt.int(Math.abs(imb.ace))} MW, the gap between planned and actual exchange`],
            ]}
          />
        </div>
      )}
    </div>
  );
}
