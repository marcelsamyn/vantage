import type { ReactElement } from "react";
import { fmt } from "../../app/core/format";
import { useNow, usePoll, useStoredState } from "../../app/core/hooks";
import { useLocation } from "../../app/core/location";
import { profile } from "../../app/core/profile";
import { useSettings } from "../../app/core/settings";
import { Empty, LiveDot, Scanning, Segmented, Stat } from "../../app/ui";
import { distanceM } from "../../shared/geo";
import { fetchQuakes, fetchSeismo, formatVelocity, groundMotion } from "./client";
import { Seismograph } from "./Seismograph";
import type { Quake } from "./types";
import { VolcanoPanel } from "./VolcanoPanel";
import "./hazards.css";

/** Briefing tile: the planet's seismic day, the nearest quake to you, and the live ground motion at the seismic station nearest you. */
export default function HazardTile(): ReactElement {
  const { data, error } = usePoll((signal) => fetchQuakes("day", signal), 2 * 60_000, []);
  const here = useLocation((s) => s.here);
  const units = useSettings((s) => s.units);
  const now = useNow(60_000);
  const spot = here ? `${here.lat.toFixed(2)},${here.lon.toFixed(2)}` : null;
  const [mode, setMode] = useStoredState<"near" | "volcanoes">("hazards.seismograph", "near");
  const seismo = usePoll((signal) => (here ? fetchSeismo(here, undefined, signal) : Promise.reject(new Error("no location"))), 20_000, [spot], !here || mode !== "near");

  if (error && !data) return <Empty title="No seismic feed" tone="error">{error.message}</Empty>;
  if (!data) return <Scanning label="Listening to the planet" />;

  const felt = data.filter((q) => q.mag >= 2.5);
  const strongest = [...data].sort((a, b) => b.mag - a.mag)[0];
  const nearest = here ? [...data].sort((a, b) => distanceM(here, a) - distanceM(here, b))[0] : undefined;
  const row = (label: string, q: Quake | undefined, extra: string): ReactElement | null =>
    q ? (
      <button type="button" className="hazards-row" onClick={() => profile.open({ kind: "quake", id: q.id, data: q })}>
        <span className="v-eyebrow">{label}</span>
        <span className="hazards-mag">M{q.mag.toFixed(1)}</span>
        <span className="hazards-place">{q.place}</span>
        <span className="v-stat__hint">{extra}</span>
      </button>
    ) : null;

  const trace = seismo.data;
  return (
    <div className="hazards-tile">
      <Stat label="Earthquakes, past 24 h" value={fmt.int(felt.length)} unit="M2.5+" tone="alarm" hint={`${fmt.int(data.length)} recorded in total, from USGS, EMSC and INGV`} />
      <div className="hazards-list">
        {row("Strongest", strongest, strongest ? fmt.ago(strongest.time, now) : "")}
        {nearest && here && row("Nearest", nearest, `${fmt.distance(distanceM(here, nearest), units)} away · ${fmt.ago(nearest.time, now)}`)}
      </div>
      <div className="hazards-live">
        <div className="hazards-live__head">
          <span className="v-eyebrow">{mode === "near" ? "Ground motion near you" : "Volcano ground motion"}</span>
          {mode === "near" && trace && <LiveDot tone="sodium" />}
          <Segmented
            label="Which seismographs to show"
            value={mode}
            options={[
              { value: "near", label: "Near you" },
              { value: "volcanoes", label: "Volcanoes" },
            ]}
            onChange={setMode}
          />
        </div>
        {mode === "volcanoes" ? (
          <VolcanoPanel />
        ) : trace ? (
          <>
            <Seismograph trace={trace} live height={64} />
            <div className="v-stat__hint">
              {trace.station.id} · {fmt.distance(trace.station.distanceKm * 1000, units)} away · {trace.station.operator}
            </div>
            <div className="v-stat__hint">
              Peak {formatVelocity(trace.peakNmS)} in ten minutes. {groundMotion(trace.peakNmS).label}.
            </div>
          </>
        ) : seismo.error && here ? (
          <div className="v-stat__hint">{seismo.error.message}</div>
        ) : (
          <Scanning label="Finding the nearest seismic station" />
        )}
      </div>
    </div>
  );
}
