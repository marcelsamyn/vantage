import { ExternalLink, Footprints } from "lucide-react";
import type { ReactElement } from "react";
import { fmt } from "../../app/core/format";
import { useLocation } from "../../app/core/location";
import type { ProfilerProps } from "../../app/core/plugin";
import { useSettings } from "../../app/core/settings";
import { Button, ProfilerCard } from "../../app/ui";
import { bearingDeg, compassPoint, distanceM } from "../../shared/geo";
import { routeTo } from "../city/client";
import { DESCRIBE, address, describeRows } from "./describe";

/** Profiler for anything on the street grid: cameras, signals, towers, defibrillators and more. */
export default function GridProfile({ entity, onClose }: ProfilerProps<"grid">): ReactElement {
  const g = entity.data;
  const d = DESCRIBE[g.kind];
  const here = useLocation((s) => s.here);
  const units = useSettings((s) => s.units);
  const name = g.name ?? d.fallbackName;

  return (
    <ProfilerCard
      band={d.band}
      tone={d.tone}
      name={name}
      kicker={address(g.tags) ?? fmt.coord(g.lat, g.lon)}
      onClose={onClose}
      rows={[
        ...describeRows(g.kind, g),
        here && ["From you", `${fmt.distance(distanceM(here, g), units)} ${compassPoint(bearingDeg(here, g))}`],
      ]}
      fact={d.fact(g.tags, g)}
      actions={
        <>
          <Button size="sm" icon={<Footprints size={13} />} onClick={() => void routeTo({ lat: g.lat, lon: g.lon, name }, "foot")}>
            Walk here
          </Button>
          <a className="v-btn v-btn--sm v-btn--ghost" href={`https://www.openstreetmap.org/${g.osm}`} target="_blank" rel="noreferrer">
            <ExternalLink size={13} /> OSM
          </a>
        </>
      }
      source="© OpenStreetMap contributors (ODbL)"
    />
  );
}
