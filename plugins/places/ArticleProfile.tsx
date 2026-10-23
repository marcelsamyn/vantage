import { ExternalLink, Footprints } from "lucide-react";
import type { ReactElement } from "react";
import { fmt } from "../../app/core/format";
import { usePoll } from "../../app/core/hooks";
import { useLocation } from "../../app/core/location";
import type { ProfilerProps } from "../../app/core/plugin";
import { useSettings } from "../../app/core/settings";
import { Button, ProfilerCard } from "../../app/ui";
import { bearingDeg, compassPoint, distanceM } from "../../shared/geo";
import { routeTo } from "../city/client";
import { fetchSummary } from "./client";

/** Profiler for a Wikipedia place: what it is and why it matters, in two sentences. */
export default function ArticleProfile({ entity, onClose }: ProfilerProps<"article">): ReactElement {
  const a = entity.data;
  const here = useLocation((s) => s.here);
  const units = useSettings((s) => s.units);
  const { data, error, loading } = usePoll((signal) => fetchSummary(a.title, signal), null, [a.title]);
  const sentences = data?.extract.split(/(?<=[.!?])\s+/) ?? [];

  return (
    <ProfilerCard
      band="Place profile"
      tone="ice"
      name={a.title}
      kicker={data?.description ?? a.description ?? "Wikipedia"}
      media={data?.thumbnail ?? a.thumbnail}
      loading={loading && !data}
      onClose={onClose}
      rows={[
        ["Position", fmt.coord(a.lat, a.lon)],
        here && ["From you", `${fmt.distance(distanceM(here, a), units)} ${compassPoint(bearingDeg(here, a))}`],
        error && ["Summary", `Unavailable — ${error.message}`],
      ]}
      fact={sentences.length ? sentences.slice(0, 3).join(" ") : undefined}
      actions={
        <>
          <Button size="sm" icon={<Footprints size={13} />} onClick={() => void routeTo({ lat: a.lat, lon: a.lon, name: a.title }, "foot")}>
            Walk here
          </Button>
          <a className="v-btn v-btn--sm v-btn--ghost" href={data?.url ?? `https://en.wikipedia.org/wiki/${encodeURIComponent(a.title)}`} target="_blank" rel="noreferrer">
            <ExternalLink size={13} /> Read more
          </a>
        </>
      }
      source="Wikipedia (CC BY-SA)"
    />
  );
}
