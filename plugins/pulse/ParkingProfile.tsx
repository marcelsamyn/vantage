import { ExternalLink, Footprints } from "lucide-react";
import type { ReactElement } from "react";
import { fmt } from "../../app/core/format";
import { useNow } from "../../app/core/hooks";
import { useLocation } from "../../app/core/location";
import type { ProfilerProps } from "../../app/core/plugin";
import { useSettings } from "../../app/core/settings";
import { Button, Meter, ProfilerCard, Stat } from "../../app/ui";
import { bearingDeg, compassPoint, distanceM } from "../../shared/geo";
import { routeTo } from "../city/client";
import { useParking } from "./client";
import { parkOccupied, parkTone } from "./words";
import "./pulse.css";

const TONE = { mint: "mint", sodium: "sodium", alarm: "alarm", closed: "ice" } as const;

/** One car park: free spaces now, how full it is, and when the operator last said so. */
export default function ParkingProfile({ entity, onClose }: ProfilerProps<"carpark">): ReactElement {
  const { data } = useParking();
  const park = data?.parks.find((p) => p.id === entity.data.park.id) ?? entity.data.park;
  const now = useNow(15_000);
  const here = useLocation((s) => s.here);
  const units = useSettings((s) => s.units);
  const tone = parkTone(park);
  const occupied = parkOccupied(park);

  return (
    <ProfilerCard
      band="Car park · live"
      tone={TONE[tone]}
      name={park.name}
      kicker={`${park.city}${park.detail && park.city === "Zurich" ? ` · ${park.detail}` : ""}`}
      onClose={onClose}
      rows={[
        park.capacity !== null && ["Spaces in total", fmt.int(park.capacity)],
        park.free !== null && park.capacity !== null && ["Taken", `${fmt.int(park.capacity - park.free)} (${Math.round(occupied * 100)}%)`],
        ["Status", park.open ? "Open" : "Closed or not reporting"],
        park.detail && park.city === "Ghent" && ["Hours", park.detail],
        park.at !== null && ["Updated", fmt.ago(park.at, now)],
        here && ["From you", `${fmt.distance(distanceM(here, park), units)} ${compassPoint(bearingDeg(here, park))}`],
      ]}
      fact="Free spaces come from the barrier counts of the operator, so they can be a few minutes behind a car that just drove in."
      actions={
        <>
          <Button size="sm" icon={<Footprints size={13} />} onClick={() => void routeTo({ lat: park.lat, lon: park.lon, name: park.name }, "foot")}>
            Walk here
          </Button>
          {park.url && (
            <a className="v-btn v-btn--sm v-btn--ghost" href={park.url} target="_blank" rel="noreferrer">
              <ExternalLink size={13} /> Operator
            </a>
          )}
        </>
      }
      source={`${SOURCES[park.city]}`}
    >
      <div className="pulse-park">
        <Stat label="Free now" value={park.free === null ? "n/a" : fmt.int(park.free)} unit={park.capacity !== null ? `of ${fmt.int(park.capacity)}` : undefined} size="lg" tone={tone === "closed" ? undefined : TONE[tone]} />
        <Meter value={occupied} tone={TONE[tone]} ticks />
      </div>
    </ProfilerCard>
  );
}

const SOURCES = {
  Ghent: "Stad Gent open data · Modellicentie Gratis Hergebruik",
  Bologna: "Comune di Bologna open data · CC BY 4.0",
  Zurich: "Stadt Zürich Parkleitsystem · CC0",
} as const;
