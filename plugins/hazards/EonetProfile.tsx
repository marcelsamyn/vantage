import { ExternalLink } from "lucide-react";
import type { ReactElement } from "react";
import { fmt } from "../../app/core/format";
import { useNow } from "../../app/core/hooks";
import { useLocation } from "../../app/core/location";
import type { ProfilerProps } from "../../app/core/plugin";
import { useSettings } from "../../app/core/settings";
import { ProfilerCard } from "../../app/ui";
import { bearingDeg, compassPoint, distanceM } from "../../shared/geo";
import { EONET_NAME } from "./client";
import type { EonetCategory, EonetEvent } from "./types";
import "./hazards.css";

const FACT: Record<EonetCategory, string> = {
  wildfires: "Satellites and fire agencies report fires like this one. Smoke can travel thousands of kilometres and show up in air-quality sensors far from the flames.",
  severeStorms: "Forecast centres track storms every six hours. The dashed line on the map is the path so far.",
  volcanoes: "Volcano observatories report new activity here. An erupting volcano can send ash high enough to close airspace.",
  seaLakeIce: "Icebergs drift with currents and are tracked by satellite radar, because ships cannot always see them.",
  floods: "Flood events come from satellite imagery and agency reports; the position is the centre of the affected area.",
  dustHaze: "Dust and haze events are seen from space. Saharan dust sometimes crosses the Mediterranean and tints the sky over Italy.",
  drought: "Drought is slow: this marks the place the report is about, not one spot where it began.",
  landslides: "Landslides are reported by agencies and the news after heavy rain, quakes or thaws.",
  snow: "Unusual snow cover reported by weather services.",
  tempExtremes: "A heat wave or cold spell reported by weather services.",
  waterColor: "Water that changes colour, often from algae, sediment or a spill, is seen from space.",
  manmade: "An event caused by people that agencies track as a natural-hazard risk.",
  earthquakes: "A significant earthquake from the EONET list.",
};

/** Profiler for a NASA EONET natural event. */
export default function EonetProfile({ entity, onClose }: ProfilerProps<"eonet">): ReactElement {
  const e: EonetEvent = entity.data;
  const here = useLocation((s) => s.here);
  const units = useSettings((s) => s.units);
  const now = useNow(60_000);
  const date = Date.parse(e.date);
  const fire = e.category === "wildfires" || e.category === "volcanoes";
  return (
    <ProfilerCard
      band={`Natural event · ${EONET_NAME[e.category]}`}
      tone={fire ? "alarm" : "sodium"}
      name={e.title}
      kicker={e.categoryTitle}
      onClose={onClose}
      rows={[
        ["Last update", Number.isFinite(date) ? `${new Date(date).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })} · ${fmt.ago(date, now)}` : e.date],
        e.magnitude && ["Size", `${fmt.int(e.magnitude.value)} ${e.magnitude.unit}`],
        ["Position", fmt.coord(e.lat, e.lon)],
        here && ["From you", `${fmt.distance(distanceM(here, e), units)} ${compassPoint(bearingDeg(here, e))}`],
        e.track.length > 1 && ["Track", `${e.track.length} recorded positions`],
        ["Reported by", e.sources.map((s) => s.id).join(", ") || "NASA EONET"],
      ]}
      fact={FACT[e.category]}
      actions={
        <div className="hazards-links">
          <a className="v-btn v-btn--sm v-btn--ghost" href={e.link} target="_blank" rel="noreferrer">
            <ExternalLink size={13} /> EONET record
          </a>
          {e.sources[0] && (
            <a className="v-btn v-btn--sm v-btn--ghost" href={e.sources[0].url} target="_blank" rel="noreferrer">
              <ExternalLink size={13} /> {e.sources[0].id}
            </a>
          )}
        </div>
      }
      source="NASA Earth Observatory Natural Event Tracker (EONET)"
    />
  );
}
