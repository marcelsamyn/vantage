import type { ReactElement } from "react";
import { fmt } from "../../app/core/format";
import { usePoll } from "../../app/core/hooks";
import { useSettings } from "../../app/core/settings";
import { LiveDot, Scanning } from "../../app/ui";
import { fetchVolcanoes, formatVelocity } from "./client";
import { Seismograph } from "./Seismograph";
import "./hazards.css";

/** What each mountain's trace tends to show, so a viewer knows what a burst means. */
const WHAT_TO_LOOK_FOR: Record<string, string> = {
  etna: "Etna's constant hum, called tremor, swells before and during eruptions.",
  stromboli: "Stromboli throws a small explosion every ten to twenty minutes or so; each shows as a sharp burst.",
  "campi-flegrei": "Campi Flegrei is a caldera whose ground is slowly rising; its small quakes show as short spikes.",
};

/**
 * Ground shaking at Italy's three monitored volcanoes, one seismograph each, labelled with the station and how far it sits
 * from the crater. Live, it follows the clock. With `moment` it shows the recording from that time instead, with a
 * marker, so a quake's profile can ask whether the volcanoes noticed.
 */
export function VolcanoPanel({ moment }: { moment?: number }): ReactElement {
  const units = useSettings((s) => s.units);
  const live = moment === undefined;
  const { data, error } = usePoll((signal) => fetchVolcanoes(moment, signal), live ? 20_000 : null, [moment]);

  if (!data) return error ? <div className="v-stat__hint">{error.message}</div> : <Scanning label="Listening to the volcanoes" />;
  return (
    <div className="hazards-volcanoes">
      <p className="hazards-volcanoes__lead">
        Seismometers sit on the mountains themselves, so they hear far more than a city station does. Look for the shape: a steady hum, sharp bursts or short spikes.
      </p>
      {data.map((v) => (
        <div key={v.id} className="hazards-volcano">
          <div className="hazards-volcano__head">
            <span className="hazards-volcano__name">{v.name}</span>
            {v.trace && live && <LiveDot tone="sodium" />}
            <span className="v-stat__hint hazards-volcano__where">
              {v.trace ? `${v.trace.station.id} · ${fmt.distance(v.trace.station.distanceKm * 1000, units)} from the ${v.summitName}` : "no station answering"}
            </span>
          </div>
          {v.trace ? (
            <>
              <Seismograph trace={v.trace} live={live} height={52} markMs={moment} />
              <div className="v-stat__hint">
                Peak {formatVelocity(v.trace.peakNmS)} · typical {formatVelocity(v.trace.rmsNmS)}. {WHAT_TO_LOOK_FOR[v.id]}
                {v.trace.skipped.length > 0 && ` Closer stations (${v.trace.skipped.join(", ")}) ${live ? "are not sending live data" : "have no record of that time"}.`}
              </div>
            </>
          ) : (
            <div className="v-stat__hint">{v.error}</div>
          )}
        </div>
      ))}
    </div>
  );
}
