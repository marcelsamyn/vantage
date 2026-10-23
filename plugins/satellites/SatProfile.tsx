import { ExternalLink } from "lucide-react";
import { useMemo, type ReactElement } from "react";
import { fmt } from "../../app/core/format";
import { useNow } from "../../app/core/hooks";
import { useLocation } from "../../app/core/location";
import type { ProfilerProps } from "../../app/core/plugin";
import { ProfilerCard } from "../../app/ui";
import { compassPoint } from "../../shared/geo";
import { displayName, inclinationDeg, lookFrom, passes, periodMin, satFromRef, stateAt } from "./client";

/** Profiler for a satellite: where it is, how fast it goes, and when you can next see it. */
export default function SatProfile({ entity, onClose }: ProfilerProps<"satellite">): ReactElement {
  const sat = useMemo(() => satFromRef(entity.data), [entity.data]);
  const here = useLocation((s) => s.here);
  const now = useNow(1000);
  const date = new Date(now);
  const st = stateAt(sat.rec, date);
  const look = here ? lookFrom(sat.rec, here, date) : null;
  const period = periodMin(sat.rec);
  const next = useMemo(() => (here ? (passes(sat.rec, here, new Date(), 48, 10)[0] ?? null) : null), [sat, here, Math.floor(now / 60_000)]);
  const name = displayName(entity.data.name);
  const iss = name === "ISS";

  const fact = iss
    ? `Moving at ${st ? st.speedKmS.toFixed(2) : "7.66"} km/s, the crew sees a sunrise or sunset every ${Math.round(period / 2)} minutes.`
    : st
      ? `It circles Earth every ${Math.round(period)} minutes, ${(1440 / period).toFixed(1)} times a day, ${fmt.int(st.altKm)} km up.`
      : undefined;

  return (
    <ProfilerCard
      band={entity.data.group === "stations" ? "Space station" : "Satellite profile"}
      tone="ice"
      name={name}
      kicker={`NORAD ${entity.data.norad} · ${entity.data.group === "gps-ops" ? "GPS navigation" : entity.data.group === "starlink" ? "Starlink" : "Orbiting Earth"}`}
      onClose={onClose}
      rows={[
        st && ["Altitude", `${fmt.int(st.altKm)} km`],
        st && ["Speed", `${st.speedKmS.toFixed(2)} km/s · ${fmt.int(st.speedKmS * 3600)} km/h`],
        st && ["Over", fmt.coord(st.lat, st.lon)],
        st && ["Light", st.sunlit ? "Sunlit" : "In Earth's shadow"],
        ["Orbit", `${period.toFixed(1)} min · ${inclinationDeg(sat.rec).toFixed(1)}° inclination`],
        look && ["From you", look.el > 0 ? `${Math.round(look.el)}° up ${compassPoint(look.az)} · ${fmt.int(look.rangeKm)} km` : `Below your horizon · ${fmt.int(look.rangeKm)} km`],
        next && ["Next pass", `${fmt.clock(next.rise.getTime())} ${fmt.until(next.rise.getTime(), now)} · peak ${Math.round(next.peakEl)}°${next.visible ? " · visible" : ""}`],
      ]}
      fact={fact}
      actions={
        <a className="v-btn v-btn--sm v-btn--ghost" href={`https://celestrak.org/satcat/table-satcat.php?CATNR=${entity.data.norad}`} target="_blank" rel="noreferrer">
          <ExternalLink size={13} /> CelesTrak record
        </a>
      }
      source="Orbital elements: CelesTrak · positions computed on this Mac (SGP4)"
    />
  );
}
