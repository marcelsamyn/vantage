import type { ReactElement } from "react";
import { fmt } from "../../app/core/format";
import { delayTone, type CrowdingView } from "./client";
import type { TrainDetail, TransitAlert, TripStop } from "./types";
import "./transit.css";

/** Four pips that fill as a vehicle fills up. The colour says how comfortable the ride is. */
export function Pips({ crowding }: { crowding: CrowdingView }): ReactElement {
  return (
    <span className={`transit-pips transit-pips--${crowding.tone}`} role="img" aria-label={crowding.label}>
      {[1, 2, 3, 4].map((n) => (
        <i key={n} className={n <= crowding.level ? "transit-pips__on" : undefined} />
      ))}
    </span>
  );
}

/** "+7 min" in alarm from five minutes, sodium from one, mint when on time. */
export function Delay({ minutes, unit = "" }: { minutes: number; unit?: string }): ReactElement {
  const tone = delayTone(minutes);
  return <span className={`${tone} num`}>{minutes >= 1 ? `+${minutes}${unit}` : minutes <= -1 ? `${minutes}${unit}` : "on time"}</span>;
}

const day = (ms: number): string => new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

/** Service alerts, each folded to its headline. Open one for the operator's full text. */
export function AlertList({ alerts }: { alerts: TransitAlert[] }): ReactElement | null {
  if (alerts.length === 0) return null;
  return (
    <ul className="transit-alerts" aria-label="Service alerts">
      {alerts.map((a) => (
        <li key={a.id}>
          <details className={`transit-alert transit-alert--${a.severity}`}>
            <summary>
              <span className="transit-alert__dot" aria-hidden />
              <span className="transit-alert__title">{a.title}</span>
              {a.routes.length > 0 && <span className="transit-alert__routes num">{a.routes.slice(0, 3).join(" · ")}</span>}
            </summary>
            <div className="transit-alert__body">
              {a.text && <p>{a.text}</p>}
              <p className="faint">
                {a.operator}
                {a.from ? ` · ${a.from > Date.now() ? "from" : "since"} ${day(a.from)}` : ""}
                {a.until ? ` · until ${day(a.until)}` : ""}
                {a.link && (
                  <>
                    {" · "}
                    <a href={a.link} target="_blank" rel="noreferrer noopener">
                      Operator page
                    </a>
                  </>
                )}
              </p>
            </div>
          </details>
        </li>
      ))}
    </ul>
  );
}

export const RUN_STATUS: Record<TrainDetail["status"], string> = {
  scheduled: "Not departed yet",
  running: "Running",
  arrived: "Arrived at its last stop",
  cancelled: "Cancelled",
};

/** The time that matters at a stop: when the vehicle leaves, or when it ends its run. */
export function mainTime(s: TripStop): { planned: number | null; actual: number | null } | null {
  return s.departure ?? s.arrival;
}

function StopRow({ stop, next }: { stop: TripStop; next: boolean }): ReactElement {
  const t = mainTime(stop);
  const moved = t?.planned != null && t.actual != null && Math.abs(t.actual - t.planned) >= 60_000;
  const state = stop.cancelled ? "cancelled" : stop.passed ? "passed" : next ? "next" : "ahead";
  return (
    <li className={`transit-stop transit-stop--${state}`} aria-current={next ? "step" : undefined}>
      <span className="transit-stop__mark" aria-hidden />
      <span className="transit-stop__name">{stop.name}</span>
      <span className="transit-stop__times num">
        {t?.planned != null && <span className={moved ? "faint transit-stop__was" : undefined}>{fmt.clock(t.planned)}</span>}
        {moved && t?.actual != null && <span className={delayTone(Math.round((t.actual - (t.planned ?? t.actual)) / 60_000))}> {fmt.clock(t.actual)}</span>}
      </span>
      <span className={`transit-stop__platform num ${stop.trackChanged ? "sodium" : "faint"}`} title={stop.trackChanged ? "Platform changed" : "Platform"}>
        {stop.platform ?? ""}
      </span>
    </li>
  );
}

/** Stops shown before the next one and after it, when a run is too long to list whole. */
const BEFORE = 3;
const AFTER = 15;
const LONG = BEFORE + AFTER + 6;

/**
 * Every stop of a run, the next one marked while it runs. Some operators publish a vehicle's whole day as one run,
 * hundreds of stops long; then only the stops around the next one are listed, with a count of the rest.
 */
export function StopList({ stops, running }: { stops: readonly TripStop[]; running: boolean }): ReactElement {
  const next = stops.findIndex((s) => !s.passed && !s.cancelled);
  const anchor = next >= 0 ? next : stops.length - 1;
  const [from, to] = stops.length > LONG ? [Math.max(0, anchor - BEFORE), Math.min(stops.length, anchor + AFTER)] : [0, stops.length];
  return (
    <ol className="transit-stops" aria-label="Stops">
      {from > 0 && <li className="transit-stops__more faint">{from} earlier stops</li>}
      {stops.slice(from, to).map((s, i) => (
        <StopRow key={`${s.name}-${from + i}`} stop={s} next={running && from + i === next} />
      ))}
      {to < stops.length && <li className="transit-stops__more faint">{stops.length - to} more stops</li>}
    </ol>
  );
}
