import { Bike, ExternalLink, Footprints, MapPin } from "lucide-react";
import type { ReactElement } from "react";
import { fmt } from "../../app/core/format";
import { usePoll } from "../../app/core/hooks";
import { useLocation } from "../../app/core/location";
import type { ProfilerProps } from "../../app/core/plugin";
import { useSettings } from "../../app/core/settings";
import { Button, ProfilerCard } from "../../app/ui";
import { bearingDeg, compassPoint, distanceM } from "../../shared/geo";
import { fetchStructure, fetchWhatsHere, routeTo } from "./client";

/** Profiler for any point on Earth: what stands there, how high it is, and what Wikipedia knows nearby. */
export default function PlaceProfile({ entity, onClose }: ProfilerProps<"place">): ReactElement {
  const p = entity.data;
  const units = useSettings((s) => s.units);
  const here = useLocation((s) => s.here);
  const { data, error, loading } = usePoll((signal) => fetchWhatsHere(p, signal), null, [p.lat, p.lon]);
  const structure = usePoll((signal) => fetchStructure(p, signal), null, [p.lat, p.lon]);

  const s = structure.data;
  const a = data?.article;
  const name = s?.name ?? (p.kind !== "point" ? p.name : null) ?? a?.title ?? data?.place?.name ?? (loading ? "Profiling…" : "Unnamed spot");
  const kicker = [s?.kind ?? (p.kind !== "point" ? p.kind.replace(/_/g, " ") : null), data?.place?.area ?? p.area].filter(Boolean).join(" · ") || "Location";
  const away = here ? distanceM(here, p) : null;

  const fact = a
    ? `${a.extract.split(/(?<=\.)\s/).slice(0, 2).join(" ")}`
    : s?.built
      ? `Standing here since ${s.built}${s.architect ? `, designed by ${s.architect}` : ""}.`
      : data?.elevationM !== null && data?.elevationM !== undefined
        ? `This spot sits ${fmt.int(data.elevationM)} m above sea level.`
        : undefined;

  return (
    <ProfilerCard
      band={s ? "Structure profile" : "Location profile"}
      name={name}
      kicker={kicker}
      tone="ice"
      media={a?.thumbnail}
      loading={(loading && !data) || (structure.loading && structure.data === undefined)}
      onClose={onClose}
      rows={[
        data?.place?.context ? ["Address", data.place.context] : null,
        ["Position", fmt.coord(p.lat, p.lon)],
        data?.elevationM !== null && data?.elevationM !== undefined && ["Elevation", `${fmt.int(data.elevationM)} m`],
        s?.heightM && ["Height", `${fmt.int(s.heightM)} m${s.levels ? ` · ${s.levels} floors` : ""}`],
        s?.built && ["Built", s.built],
        s?.architect && ["Architect", s.architect],
        s?.operator && ["Operator", s.operator],
        away !== null && here && ["From you", `${fmt.distance(away, units)} ${compassPoint(bearingDeg(here, p))}`],
        error && ["Lookup", `Partial — ${error.message}`],
      ]}
      fact={fact}
      actions={
        <>
          <Button size="sm" icon={<Footprints size={13} />} onClick={() => void routeTo({ ...p, name }, "foot")}>
            Walk
          </Button>
          <Button size="sm" icon={<Bike size={13} />} onClick={() => void routeTo({ ...p, name }, "bike")}>
            Cycle
          </Button>
          <Button size="sm" variant="ghost" icon={<MapPin size={13} />} onClick={() => useLocation.getState().setManual(p.lat, p.lon, name)}>
            Pin here
          </Button>
          {a && (
            <a className="v-btn v-btn--sm v-btn--ghost" href={a.url} target="_blank" rel="noreferrer">
              <ExternalLink size={13} /> Wikipedia
            </a>
          )}
          {s && (
            <a className="v-btn v-btn--sm v-btn--ghost" href={s.osmUrl} target="_blank" rel="noreferrer">
              <ExternalLink size={13} /> OSM
            </a>
          )}
        </>
      }
      source="OpenStreetMap · Wikipedia · Open-Meteo"
    />
  );
}
