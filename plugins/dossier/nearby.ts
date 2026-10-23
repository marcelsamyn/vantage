import { TreeDeciduous } from "lucide-react";
import type { NearbyItem, NearbyProvider } from "../../app/core/nearby";
import { profile } from "../../app/core/profile";
import { distanceM, type LatLon } from "../../shared/geo";
import { fetchRemarkableTrees } from "./client";
import { spotEntity } from "./spot";
import type { MapTree } from "./types";

/** Trees that a register singles out are few and worth a detour; the nearest three keep the list short. */
const TREES = 3;

/** The nearest remarkable trees. Exported on its own, so a test can feed it recorded data. */
export function treeItems(trees: readonly MapTree[], at: LatLon, radiusM: number): NearbyItem[] {
  return trees
    .map((t) => ({ t, d: distanceM(at, t) }))
    .filter((x) => x.d <= radiusM)
    .sort((a, b) => a.d - b.d)
    .slice(0, TREES)
    .map(({ t }): NearbyItem => {
      const entity = spotEntity({ id: t.id, name: t.name, kind: "tree", context: "Remarkable tree", lat: t.lat, lon: t.lon });
      return {
        id: t.id,
        title: t.name,
        detail: "Remarkable tree",
        kind: "see",
        at: { lat: t.lat, lon: t.lon },
        icon: TreeDeciduous,
        tone: "mint",
        entity,
        primary: { label: "Show tree", run: () => profile.open(entity) },
        more: [{ label: "Walk there", run: () => import("../city/client").then((m) => m.routeTo({ lat: t.lat, lon: t.lon, name: t.name }, "foot")) }],
      };
    });
}

/** The registers' lists come from the hour-long cache that the layer reads. */
const nearby: NearbyProvider = async ({ at, radiusM }, signal) => treeItems((await fetchRemarkableTrees(signal)).trees, at, radiusM);
export default nearby;
