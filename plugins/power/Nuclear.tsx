import { motion } from "motion/react";
import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { fmt } from "../../app/core/format";
import { usePoll, usePrefersReducedMotion, useNow } from "../../app/core/hooks";
import { Readout, Stat, Tag } from "../../app/ui";
import { dateWords, endWords, fetchMix, unitName } from "./client";
import type { NuclearFleet, NuclearOutage, Reactor } from "./types";

const DAY_S = 86_400;
/** The timeline starts a little in the past, so the outage in force has a visible start, and runs to the last year Elia publishes. */
const PAST_S = 75 * DAY_S;
const FUTURE_S = Math.round(3.3 * 365 * DAY_S);
const ROW_H = 38;
const AXIS_H = 24;
const LABEL_W = 82;

const STATUS: Record<Reactor["status"], { label: string; tone: "mint" | "sodium" }> = {
  available: { label: "Available", tone: "mint" },
  reduced: { label: "Reduced", tone: "sodium" },
  offline: { label: "Offline", tone: "sodium" },
};

const daysLeft = (seconds: number): string => {
  const days = Math.ceil(seconds / DAY_S);
  return days <= 1 ? "less than a day from now" : `${fmt.int(days)} days from now`;
};

const outageTone =(o: NuclearOutage): string => (o.type === "Forced" ? "var(--alarm)" : "var(--sodium)");

/** One row per reactor, one bar per outage Elia lists, and a line for today. Drawn at the real width so the labels stay readable. */
function Timeline({ reactors, now }: { reactors: Reactor[]; now: number }): ReactElement {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(720);
  const reduced = usePrefersReducedMotion();

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(Math.max(280, el.clientWidth)));
    setWidth(Math.max(280, el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const start = now - PAST_S;
  const end = now + FUTURE_S;
  const plotW = width - LABEL_W - 8;
  const x = (t: number): number => LABEL_W + ((Math.min(end, Math.max(start, t)) - start) / (end - start)) * plotW;
  const height = AXIS_H + reactors.length * ROW_H + 6;

  const years = useMemo(() => {
    const first = new Date(start * 1000).getUTCFullYear() + 1;
    const last = new Date(end * 1000).getUTCFullYear();
    return Array.from({ length: Math.max(0, last - first + 1) }, (_, i) => ({ year: first + i, t: Date.UTC(first + i, 0, 1) / 1000 }));
  }, [start, end]);

  return (
    <div ref={box} className="power-nuclear__timeline">
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Timeline of the outages Elia lists for each Belgian reactor, from now to the end of the decade">
        {years.map(({ year, t }) => (
          <g key={year}>
            <line x1={x(t)} x2={x(t)} y1={AXIS_H - 4} y2={height - 4} className="power-nuclear__year" />
            <text x={x(t) + (x(t) > width - 36 ? -4 : 4)} y={14} textAnchor={x(t) > width - 36 ? "end" : "start"} className="power-nuclear__tick">
              {year}
            </text>
          </g>
        ))}
        {reactors.map((r, row) => {
          const y = AXIS_H + row * ROW_H;
          return (
            <g key={r.unit}>
              <text x={0} y={y + ROW_H / 2} dominantBaseline="middle" className="power-nuclear__unit">
                {unitName(r.unit)}
              </text>
              <rect x={LABEL_W} y={y + ROW_H / 2 - 2} width={plotW} height={4} rx={2} className="power-nuclear__base" />
              {r.outages.map((o, i) => {
                const x0 = x(o.from);
                const x1 = o.until === null ? x(end) : x(o.until);
                const w = Math.max(3, x1 - x0);
                const inForce = o.from <= now && (o.until === null || o.until >= now);
                return (
                  <g key={o.from}>
                    <motion.rect
                      x={x0}
                      y={y + 7}
                      width={w}
                      height={ROW_H - 14}
                      rx={3}
                      fill={outageTone(o)}
                      className={inForce ? "power-nuclear__bar power-nuclear__bar--now" : "power-nuclear__bar"}
                      style={{ transformBox: "fill-box", transformOrigin: "0% 50%" }}
                      initial={reduced ? false : { scaleX: 0 }}
                      animate={{ scaleX: 1 }}
                      transition={{ type: "spring", duration: 0.7, bounce: 0, delay: 0.1 + row * 0.08 + i * 0.07 }}
                    >
                      <title>{`${unitName(r.unit)}: ${o.reason}, ${dateWords(o.from)} to ${o.until === null ? "no end date listed" : endWords(o.until)}`}</title>
                    </motion.rect>
                    {inForce && o.until !== null && x1 - x0 > 96 && (
                      <text x={x0 + 9} y={y + ROW_H / 2} dominantBaseline="middle" className="power-nuclear__bar-label">
                        until {endWords(o.until, false)}
                      </text>
                    )}
                  </g>
                );
              })}
            </g>
          );
        })}
        <line x1={x(now)} x2={x(now)} y1={AXIS_H - 6} y2={height - 2} className="power-nuclear__now" />
        <text x={x(now) - 5} y={14} textAnchor="end" className="power-nuclear__today">
          today
        </text>
      </svg>
    </div>
  );
}

function ReactorRow({ reactor, now }: { reactor: Reactor; now: number }): ReactElement {
  const s = STATUS[reactor.status];
  const upcoming = reactor.outages.find((o) => o.from > now);
  const tone = reactor.current?.type === "Forced" ? "alarm" : s.tone;
  return (
    <li className="power-reactor">
      <div className="power-reactor__head">
        <span className="power-reactor__name">{unitName(reactor.unit)}</span>
        <Tag tone={tone}>{reactor.status === "offline" ? `Offline, ${reactor.current?.type === "Forced" ? "unplanned" : "planned"}` : s.label}</Tag>
        <span className="num power-reactor__mw">
          {fmt.int(reactor.availableMw)} of {fmt.int(reactor.capacityMw)} MW
        </span>
      </div>
      <p className="power-reactor__line">
        {reactor.current
          ? `${reactor.current.reason}. ${reactor.current.until === null ? "Elia lists no end date." : `Elia lists it as unavailable until ${endWords(reactor.current.until)}, ${daysLeft(reactor.current.until - now)}.`}`
          : "Elia lists no outage right now."}
        {upcoming && ` Next outage: ${dateWords(upcoming.from)} to ${upcoming.until === null ? "no end date" : endWords(upcoming.until)}.`}
      </p>
    </li>
  );
}

/**
 * Belgium's reactors as the grid operator sees them. The timeline is the picture: each reactor is a line, each
 * outage Elia has filed is a bar, so the pattern of the coming years shows at a glance.
 */
export function Nuclear({ fleet }: { fleet: NuclearFleet }): ReactElement {
  const clock = useNow(60_000);
  const now = Math.floor(clock / 1000);
  const mix = usePoll((signal) => fetchMix("be", signal), 10 * 60_000, []);
  const nuclearNow = useMemo(() => {
    if (!mix.data) return null;
    const at = mix.data.t.length - 1;
    // Energy-Charts leaves a source out of the mix while it generates nothing.
    const series = mix.data.series.find((s) => s.id === "nuclear");
    return { mw: series?.mw[at] ?? 0, t: mix.data.t[at] ?? 0 };
  }, [mix.data]);

  const capacity = fleet.reactors.reduce((s, r) => s + r.capacityMw, 0);
  const available = fleet.reactors.reduce((s, r) => s + r.availableMw, 0);
  const online = fleet.reactors.filter((r) => r.availableMw > 0).length;

  return (
    <div className="power-nuclear">
      <div className="power-nuclear__stats">
        <Stat
          label="Reactors that can run now"
          value={`${online} of ${fleet.reactors.length}`}
          size="lg"
          tone={online === 0 ? "sodium" : "mint"}
          hint={`${fmt.int(available)} of ${fmt.int(capacity)} MW available, as Elia lists it`}
        />
        {nuclearNow && <Stat label="Nuclear generation, measured" value={fmt.int(nuclearNow.mw)} unit="MW" size="lg" hint={`Energy-Charts, hour of ${fmt.clock(nuclearNow.t * 1000)}`} />}
      </div>

      <Timeline reactors={fleet.reactors} now={now} />

      <ul className="power-nuclear__list">
        {fleet.reactors.map((r) => (
          <ReactorRow key={r.unit} reactor={r} now={now} />
        ))}
      </ul>

      <Readout
        rows={[
          fleet.retired.length > 0 && ["Left Elia's unit list", fleet.retired.map(unitName).join(", ")],
          ["Sources", "Outages: Elia Open Data (Elia Open Data Licence). Generation: Energy-Charts, Fraunhofer ISE (CC BY 4.0)."],
          ["Reading the bars","Amber is a planned outage, red an unplanned one. Elia lists what a reactor can deliver, not what it delivers."],
        ]}
      />
    </div>
  );
}
