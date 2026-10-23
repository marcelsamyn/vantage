import { Accessibility, ChevronRight } from "lucide-react";
import type { ReactElement } from "react";
import { fmt } from "../../app/core/format";
import { useNow, usePoll } from "../../app/core/hooks";
import { profile } from "../../app/core/profile";
import { Empty, Scanning } from "../../app/ui";
import { TRAIN_CROWDING, fetchBoard, modeGroup, openTrip, trainEntityId } from "./client";
import { AlertList, Delay, Pips } from "./Parts";
import { isTransitousTrip } from "./trip-id";
import type { Departure } from "./types";
import "./transit.css";

function Row({ d, now }: { d: Departure; now: number }): ReactElement {
  const mins = Math.round((d.time - now) / 60_000);
  const delay = d.realTime && d.scheduled !== null ? Math.round((d.time - d.scheduled) / 60_000) : null;
  const train = d.train;
  const label = `${d.route} to ${d.headsign}`;
  const open = train
    ? { run: () => profile.open({ kind: "train", id: trainEntityId(train), data: train }), aria: `${label}: where is this train` }
    : isTransitousTrip(d.tripId)
      ? { run: () => openTrip({ tripId: d.tripId, label }), aria: `${label}: every stop of this run` }
      : null;
  const inner = (
    <>
      <span className="transit-dep__time num">{mins <= 0 ? "now" : mins < 15 ? `${mins} min` : fmt.clock(d.time)}</span>
      <span
        className={`transit-route transit-route--${modeGroup(d.mode)}`}
        style={d.routeColor ? { background: `#${d.routeColor}`, color: d.routeTextColor ? `#${d.routeTextColor}` : undefined } : undefined}
      >
        {d.route || "·"}
      </span>
      <span className="transit-dep__head">
        {d.headsign}
        {d.note && <span className="sodium"> · {d.note}</span>}
      </span>
      <span className="transit-dep__meta num">
        {d.accessible && <Accessibility className="faint" size={13} aria-label="Wheelchair accessible" />}
        {d.occupancy && <Pips crowding={TRAIN_CROWDING[d.occupancy]} />}
        {d.cancelled ? <span className="alarm">Cancelled</span> : delay !== null ? <Delay minutes={delay} /> : d.realTime && <span className="faint">live</span>}
        {d.track && (
          <span className={d.trackChanged ? "sodium" : "faint"} title={d.trackChanged ? "Platform changed" : "Platform"}>
            {" "}
            · {d.track}
          </span>
        )}
      </span>
      {open && <ChevronRight className="transit-dep__go" size={12} aria-hidden />}
    </>
  );
  const className = `transit-dep${d.cancelled ? " transit-dep--cancelled" : ""}`;
  return (
    <li>
      {open ? (
        <button type="button" className={`${className} transit-dep--link`} aria-label={open.aria} onClick={open.run}>
          {inner}
        </button>
      ) : (
        <div className={className}>{inner}</div>
      )}
    </li>
  );
}

/** A live departures board, refreshed every 30 s. Times count down in the last 15 minutes. */
export function Board({ stopId, limit = 10, alerts = true }: { stopId: string; limit?: number; alerts?: boolean }): ReactElement {
  const { data, error } = usePoll((signal) => fetchBoard(stopId, signal), 30_000, [stopId]);
  const now = useNow(15_000);
  if (error && !data) return <Empty title="Board unavailable" tone="error">{error.message}</Empty>;
  if (!data) return <Scanning label="Reading the board" />;
  const upcoming = data.departures.filter((d) => d.time > now - 60_000).slice(0, limit);

  return (
    <div className="transit-boardwrap">
      {data.notice && <p className="transit-notice sodium">{data.notice}</p>}
      {upcoming.length === 0 ? (
        <p className="dim">No departures in the coming hours.</p>
      ) : (
        <ol className="transit-board" aria-label="Departures">
          {upcoming.map((d) => (
            <Row key={`${d.tripId}-${d.time}`} d={d} now={now} />
          ))}
        </ol>
      )}
      {alerts && <AlertList alerts={data.alerts} />}
      <p className="transit-credit faint">{data.source}</p>
    </div>
  );
}
