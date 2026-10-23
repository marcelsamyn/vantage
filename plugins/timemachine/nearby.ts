import { Hourglass } from "lucide-react";
import type { NearbyItem, NearbyProvider } from "../../app/core/nearby";
import type { LatLon } from "../../shared/geo";
import { fetchEras } from "./client";
import type { Era } from "./types";

/** "This street in 1777": the oldest map or aerial photo of where you stand, and a couple of later ones. */
export function eraItem(eras: readonly Era[], at: LatLon): NearbyItem | null {
  const ground = eras.filter((e) => e.kind !== "orbit");
  const oldest = ground[0];
  if (!oldest) return null;
  const show = (era: Era) => () => import("./actions").then((m) => m.showEra(era, at));
  const later = ground.slice(1);
  const picks = later.length > 2 ? [later[0], later[later.length - 1]] : later;
  return {
    id: oldest.id,
    title: `This street in ${oldest.yearLabel}`,
    detail: `${oldest.name} · ${oldest.publisher}`,
    kind: "see",
    at: "here",
    icon: Hourglass,
    tone: "fog",
    primary: { label: "Show it", run: show(oldest) },
    more: picks.flatMap((e) => (e ? [{ label: `Show ${e.yearLabel}`, run: show(e) }] : [])),
  };
}

const nearby: NearbyProvider = async ({ at }, signal) => {
  const item = eraItem((await fetchEras(at, signal)).eras, at);
  return item ? [item] : [];
};
export default nearby;
