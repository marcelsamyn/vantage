import type { ReactElement } from "react";
import { fmt } from "../../app/core/format";
import { usePoll } from "../../app/core/hooks";
import { useLocation } from "../../app/core/location";
import { profile } from "../../app/core/profile";
import { useSettings } from "../../app/core/settings";
import { Empty, Scanning, Stat } from "../../app/ui";
import { fetchStreet, LEVEL_TONE, showValue } from "./client";
import type { Sensor, SensorKind } from "./types";
import "./sensors.css";

const LABEL: Record<SensorKind, string> = { air: "Air · PM2.5", noise: "Noise", radiation: "Radiation" };
const NONE: Record<SensorKind, string> = {
  air: "No air sensor within 25 km",
  noise: "No noise meter on the network",
  radiation: "No radiation reading near you",
};

/** Briefing tile: the nearest air, noise and radiation reading to where you are, with how far away each one is. */
export default function StreetTile(): ReactElement {
  const here = useLocation((s) => s.here);
  const units = useSettings((s) => s.units);
  const spot = here ? `${here.lat.toFixed(2)},${here.lon.toFixed(2)}` : null;
  const { data, error } = usePoll((signal) => (here ? fetchStreet(here, signal) : Promise.reject(new Error("no location"))), 2 * 60_000, [spot], !here);

  if (!here) return <Empty title="Where are you?">Set your location to see the sensors around you.</Empty>;
  if (error && !data) return <Empty title="Sensors unreachable" tone="error">{error.message}</Empty>;
  if (!data) return <Scanning label="Finding the sensors nearest you" />;

  const cell = (kind: SensorKind, s: Sensor | null): ReactElement => {
    if (!s) {
      return (
        <div className="sensors-cell sensors-cell--none" key={kind}>
          <Stat label={LABEL[kind]} value="–" hint={NONE[kind]} size="sm" />
        </div>
      );
    }
    const far = s.distanceM > 50_000;
    return (
      <button type="button" className="sensors-cell" key={kind} onClick={() => profile.open({ kind: "sensor", id: s.id, data: s })}>
        <Stat
          label={LABEL[kind]}
          value={showValue(s)}
          unit={s.unit}
          tone={LEVEL_TONE[s.level]}
          size="sm"
          hint={
            <>
              {fmt.distance(s.distanceM, units)} away{far ? ", the nearest on its network" : ""} · {s.live ? fmt.ago(s.at) : `survey ${new Date(s.at).getFullYear()}`}
            </>
          }
        />
      </button>
    );
  };

  return (
    <div className="sensors-tile">
      {cell("air", data.air)}
      {cell("noise", data.noise)}
      {cell("radiation", data.radiation)}
    </div>
  );
}
