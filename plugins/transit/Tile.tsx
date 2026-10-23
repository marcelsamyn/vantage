import type { ReactElement } from "react";
import { fmt } from "../../app/core/format";
import { usePoll } from "../../app/core/hooks";
import { useLocation } from "../../app/core/location";
import { profile } from "../../app/core/profile";
import { useSettings } from "../../app/core/settings";
import { Empty, Scanning } from "../../app/ui";
import { distanceM } from "../../shared/geo";
import { Board } from "./Board";
import { fetchAlerts, fetchStops } from "./client";
import { AlertList } from "./Parts";
import type { TransitStop } from "./types";
import "./transit.css";

const RADIUS_DEG = 0.007;

/** Briefing tile: the departures at the stop nearest to you, and the service alerts that touch your area. */
export default function TransitTile(): ReactElement {
  const here = useLocation((s) => s.here);
  const status = useLocation((s) => s.status);
  const units = useSettings((s) => s.units);
  const place = here ? `${here.lat.toFixed(3)},${here.lon.toFixed(3)}` : null;

  const stops = usePoll(
    async (signal): Promise<TransitStop | null> => {
      if (!here) return null;
      const list = await fetchStops({ west: here.lon - RADIUS_DEG, east: here.lon + RADIUS_DEG, south: here.lat - RADIUS_DEG, north: here.lat + RADIUS_DEG }, signal);
      return list.sort((a, b) => distanceM(here, a) - distanceM(here, b))[0] ?? null;
    },
    null,
    [place],
    !here,
  );
  const alerts = usePoll((signal) => (here ? fetchAlerts(here.lat, here.lon, signal) : Promise.reject(new Error("no location"))), 300_000, [place], !here);

  if (!here) return status === "locating" ? <Scanning label="Locating" /> : <Empty title="Location unknown">Pin a place from the command palette to see the transit around it.</Empty>;

  const area = alerts.data?.slice(0, 3) ?? [];
  const total = alerts.data?.length ?? 0;
  const stop = stops.data;

  return (
    <div className="transit-tile">
      {stops.error && !stop ? (
        <Empty title="Stops unavailable" tone="error">{stops.error.message}</Empty>
      ) : stops.loading && stop === undefined ? (
        <Scanning label="Finding the nearest stop" />
      ) : stop ? (
        <section>
          <button type="button" className="transit-tile__stop" onClick={() => profile.open({ kind: "stop", id: stop.stopId, data: stop })}>
            <span className="v-eyebrow">Nearest stop</span>
            <span className="transit-tile__name">{stop.name}</span>
            <span className="v-stat__hint num">{fmt.distance(distanceM(here, stop), units)} from you</span>
          </button>
          <Board stopId={stop.stopId} limit={3} alerts={false} />
        </section>
      ) : (
        <p className="dim">No stop within {fmt.distance(RADIUS_DEG * 111_000, units)} of you. Open the City map to find transit further out.</p>
      )}
      <section>
        <span className="v-eyebrow">{total > 0 ? `Service alerts near you · ${total}` : "Service alerts near you"}</span>
        {alerts.error && !alerts.data ? (
          <p className="dim">Alerts are unavailable: {alerts.error.message}</p>
        ) : alerts.data && area.length === 0 ? (
          <p className="dim">Nothing reported on the lines around you.</p>
        ) : (
          <AlertList alerts={area} />
        )}
      </section>
    </div>
  );
}
