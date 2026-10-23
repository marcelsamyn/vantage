import { AnimatePresence, motion } from "motion/react";
import { Map as MapIcon, Play, Square } from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent, type ReactElement } from "react";
import { fmt } from "../../app/core/format";
import { Button, Empty, Input, Meter, Panel, Scanning, Stat, Tag } from "../../app/ui";
import { showTraceOnMap } from "./actions";
import { locationDoubtful } from "./geo";
import { placeLabel, routeStops } from "./model";
import { useTrace } from "./trace-store";
import type { TraceHop } from "./types";
import type { Origin } from "./client";

const SUGGESTIONS = ["1.1.1.1", "8.8.8.8", "apple.com", "wikipedia.org"] as const;

export function TraceTab(): ReactElement {
  const host = useTrace((s) => s.host);
  const status = useTrace((s) => s.status);
  const hops = useTrace((s) => s.hops);
  const ip = useTrace((s) => s.ip);
  const reached = useTrace((s) => s.reached);
  const error = useTrace((s) => s.error);
  const geoNote = useTrace((s) => s.geoNote);
  const origin = useTrace((s) => s.origin);
  const [input, setInput] = useState(host);
  const running = status === "running";

  // A command or a profile can start a trace; show its host in the field.
  useEffect(() => setInput(host), [host]);

  const run = (value: string): void => {
    const target = value.trim();
    if (target) useTrace.getState().start(target);
  };
  const submit = (e: FormEvent): void => {
    e.preventDefault();
    run(input);
  };

  const stops = useMemo(() => routeStops(origin, hops), [origin, hops]);
  const maxRtt = Math.max(50, ...hops.map((h) => h.rttMs ?? 0));
  const last = [...hops].reverse().find((h) => h.rttMs !== null);
  const countries = new Set(hops.flatMap((h) => (h.geo ? [h.geo.countryCode] : []))).size;

  return (
    <div className="wire-stack">
      <Panel title="Trace a route">
        <form className="wire-tracebar" onSubmit={submit}>
          <Input className="wire-tracebar__input" value={input} onChange={(e) => setInput(e.target.value)} placeholder="e.g. google.com" aria-label="Host to trace" inputMode="url" />
          {running ? (
            <Button icon={<Square size={13} />} onClick={() => useTrace.getState().cancel()}>
              Stop
            </Button>
          ) : (
            <Button variant="primary" type="submit" icon={<Play size={13} />} disabled={input.trim() === ""}>
              Run trace
            </Button>
          )}
        </form>
        <div className="wire-suggest">
          <span className="wire-suggest__label">Try</span>
          {SUGGESTIONS.map((s) => (
            <button key={s} type="button" className="wire-chip wire-chip--plain" disabled={running} onClick={() => run(s)}>
              {s}
            </button>
          ))}
        </div>
      </Panel>

      {status === "idle" && (
        <Panel>
          <Empty title="Follow your packets">
            A trace sends a few small probe packets toward a host, the same as the traceroute command. Each router on the way answers once, so you see every step between this Mac and the destination.
          </Empty>
        </Panel>
      )}

      {status === "failed" && hops.length === 0 && (
        <Panel>
          <Empty title="The trace did not start" tone="error">
            {error}
          </Empty>
        </Panel>
      )}

      {status !== "idle" && !(status === "failed" && hops.length === 0) && (
        <>
          <div className="wire-tracestats">
            <Stat size="sm" label="Hops" value={hops.length} />
            <Stat size="sm" label="Last reply" value={last?.rttMs != null ? fmt.one(last.rttMs) : "–"} unit={last?.rttMs != null ? "ms" : undefined} />
            <Stat size="sm" label="Countries" value={countries} />
            <div className="wire-tracestatus">
              <div className="v-eyebrow">Result</div>
              {running ? <Scanning label={`Tracing ${ip ?? host}`} /> : <TraceResult status={status} reached={reached} ip={ip} host={host} />}
            </div>
          </div>

          <Panel
            title="Route"
            flush
            actions={
              !running && stops.length > 0 && origin ? (
                <Button size="sm" icon={<MapIcon size={13} />} onClick={() => showTraceOnMap([origin, ...stops])}>
                  Show route on the map
                </Button>
              ) : undefined
            }
          >
            <ol className="wire-hops">
              <AnimatePresence initial={false}>
                {hops.map((h) => (
                  <HopLine key={h.hop} hop={h} maxRtt={maxRtt} origin={origin} locating={running} />
                ))}
              </AnimatePresence>
            </ol>
          </Panel>

          {status === "failed" && error && <p className="wire-note wire-note--warn">{error}</p>}
          {geoNote && <p className="wire-note wire-note--warn">{geoNote}</p>}
        </>
      )}

      <p className="wire-note">
        Routers often ignore probes, so a hop can show no reply even when your traffic passes through it. Locations come from GeoJS and can be wrong, especially for addresses that exist in many cities at once, such as public DNS services.
      </p>
    </div>
  );
}

function TraceResult({ status, reached, ip, host }: { status: "done" | "stopped" | "failed"; reached: boolean; ip: string | null; host: string }): ReactElement {
  if (status === "stopped") return <Tag>Stopped</Tag>;
  if (reached) return <Tag tone="mint">Reached {ip && ip !== host ? `${host} · ${ip}` : host}</Tag>;
  return (
    <span className="wire-result" title="Firewalls often drop trace probes, so this does not mean the host is down.">
      <Tag tone="alarm">Did not reach it</Tag>
    </span>
  );
}

function HopLine({ hop, maxRtt, origin, locating }: { hop: TraceHop; maxRtt: number; origin: Origin | null; locating: boolean }): ReactElement {
  const silent = hop.ip === null;
  const doubtful = origin !== null && hop.geo !== null && hop.rttMs !== null && locationDoubtful(origin, hop.geo, hop.rttMs);
  return (
    <motion.li
      className={`wire-hop${silent ? " wire-hop--silent" : ""}${hop.scope === "public" ? " wire-hop--public" : ""}`}
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ type: "spring", duration: 0.4, bounce: 0 }}
    >
      <span className="wire-hop__no">{hop.hop}</span>
      <span className="wire-hop__addr">
        {silent ? (
          <span className="wire-hop__quiet" title="This router did not answer. That is common and not a problem.">
            No reply
          </span>
        ) : (
          hop.ip
        )}
      </span>
      <span className="wire-hop__where">
        {hop.scope === "private" && <Tag tone="ice">Your network</Tag>}
        {hop.scope === "public" && hop.geo && (
          <>
            <span className="wire-hop__place">{placeLabel(hop.geo)}</span>
            {hop.geo.isp && <span className="wire-hop__isp">{hop.geo.isp}</span>}
            {doubtful && (
              <span title="The reply came back faster than light could travel to this place, so the address is probably served from somewhere closer.">
                <Tag tone="alarm">Location doubtful</Tag>
              </span>
            )}
          </>
        )}
        {hop.scope === "public" && !hop.geo && <span className="wire-hop__isp">{locating ? "Locating…" : "Location unknown"}</span>}
      </span>
      <span className="wire-hop__rtt">
        {hop.rttMs !== null && (
          <>
            <Meter value={hop.rttMs} max={maxRtt} tone={hop.scope === "public" ? "sodium" : "ice"} />
            <span className="num wire-hop__ms">{fmt.one(hop.rttMs)} ms</span>
          </>
        )}
      </span>
    </motion.li>
  );
}
