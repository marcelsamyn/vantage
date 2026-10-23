import { Footprints } from "lucide-react";
import type { ReactElement } from "react";
import { fmt } from "../../app/core/format";
import { useLocation } from "../../app/core/location";
import type { ProfilerProps } from "../../app/core/plugin";
import { useSettings } from "../../app/core/settings";
import { Button, ProfilerCard } from "../../app/ui";
import { bearingDeg, compassPoint, distanceM } from "../../shared/geo";
import { routeTo } from "../city/client";

/** Profiler for a bike-share station. */
export default function StationProfile({ entity, onClose }: ProfilerProps<"bikestation">): ReactElement {
  const s = entity.data;
  const here = useLocation((st) => st.here);
  const units = useSettings((st) => st.units);
  const updated = new Date(s.updated.replace(/Z$/, "").replace(/\+00:00$/, "Z")).getTime();
  return (
    <ProfilerCard
      band="Bike share"
      tone={s.bikes === 0 ? "alarm" : s.bikes < 3 ? "sodium" : "mint"}
      name={s.name || "Bike station"}
      kicker={s.networkName}
      onClose={onClose}
      rows={[
        ["Bikes", `${s.bikes}${s.ebikes !== null ? ` · ${s.ebikes} electric` : ""}`],
        s.docks !== null && ["Free docks", String(s.docks)],
        !s.renting && ["Status", "Not renting right now"],
        Number.isFinite(updated) && ["Updated", fmt.ago(updated)],
        here && ["From you", `${fmt.distance(distanceM(here, s), units)} ${compassPoint(bearingDeg(here, s))}`],
      ]}
      fact={s.bikes === 0 ? "No bikes here right now. Stations nearby often refill within minutes at rush hour." : "Unlock a bike with the operator's app or a card at the station."}
      actions={
        <Button size="sm" icon={<Footprints size={13} />} onClick={() => void routeTo({ lat: s.lat, lon: s.lon, name: s.name }, "foot")}>
          Walk here
        </Button>
      }
      source="CityBikes (open bike-share data)"
    />
  );
}
