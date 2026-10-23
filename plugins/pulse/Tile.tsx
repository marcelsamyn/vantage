import type { ReactElement } from "react";
import { fmt } from "../../app/core/format";
import { useLocation } from "../../app/core/location";
import { profile } from "../../app/core/profile";
import { useSettings } from "../../app/core/settings";
import { Empty, Scanning } from "../../app/ui";
import { compassPoint } from "../../shared/geo";
import { showLayer } from "../city/client";
import { useNearest } from "./client";
import type { NearestItem } from "./types";
import "./pulse.css";

const PIP: Record<NearestItem["tone"], string> = { mint: "var(--mint)", sodium: "var(--sodium)", alarm: "var(--alarm)", ice: "var(--ice)" };
const MAX_ROWS = 5;

function open(item: NearestItem): void {
  if (item.entity) profile.open(item.entity);
  else if (item.kind === "signal") showLayer("pulse.signals");
}

/** The live city things nearest to you, with distances. Says plainly when nothing nearby publishes live data. */
export default function PulseTile(): ReactElement {
  const here = useLocation((s) => s.here);
  const status = useLocation((s) => s.status);
  const units = useSettings((s) => s.units);
  const { data, error, loading } = useNearest(here?.lat ?? null, here?.lon ?? null);

  if (!here) {
    return status === "locating" ? <Scanning label="Locating" /> : <Empty title="Location unknown">Pin a place from the command palette to see which city feeds are near you.</Empty>;
  }
  if (error && !data) {
    return (
      <Empty title="City feeds are not answering" tone="error">
        {error.message}
      </Empty>
    );
  }
  if (!data) return loading ? <Scanning label="Listening to the city" /> : <Empty title="Nothing yet">Waiting for the first reading.</Empty>;

  if (data.items.length === 0) {
    const c = data.closestCovered;
    const where = here.label ?? "Your area";
    return (
      <Empty title={`${where} publishes none of these feeds`}>
        {c ? (
          <>
            No live car parks, counters, bridges or river gauges lie within range. The closest city with live data is {c.city}, {fmt.distance(c.distanceM, units)} {compassPoint(c.bearing)} of you: {c.feeds.join(", ")}.
          </>
        ) : (
          "No live car parks, counters, bridges or river gauges lie within range."
        )}
      </Empty>
    );
  }

  return (
    <>
      <ul className="pulse-tile">
        {data.items.slice(0, MAX_ROWS).map((item) => (
          <li key={`${item.kind}:${item.title}`}>
            <button type="button" className="pulse-tile__row" onClick={() => open(item)} disabled={!item.entity && item.kind !== "signal"}>
              <span className="pulse-tile__pip" style={{ background: PIP[item.tone] }} aria-hidden />
              <span>
                <span className="pulse-tile__title">{item.title}</span>
                <span className="pulse-tile__detail">{item.detail}</span>
              </span>
              <span className="pulse-tile__distance num">{fmt.distance(item.distanceM, units)}</span>
            </button>
          </li>
        ))}
      </ul>
      <p className="pulse-tile__foot">Live where cities publish it as open data: Hamburg, the Netherlands, Brussels, Ghent, Bologna, Zurich, France and Lombardy.</p>
    </>
  );
}
