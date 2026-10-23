import { Landmark } from "lucide-react";
import type { NearbyItem, NearbyProvider } from "../../app/core/nearby";
import { profile } from "../../app/core/profile";
import { distanceM, type LatLon } from "../../shared/geo";
import { fetchArticlesNear } from "./client";
import type { Article } from "./types";

/** Landmarks with an article; the nearest few keep the list about what you can walk to. */
const MAX = 8;

export function articleItems(articles: readonly Article[], at: LatLon, radiusM: number): NearbyItem[] {
  return articles
    .map((a) => ({ a, d: distanceM(at, a) }))
    .filter((x) => x.d <= radiusM)
    .sort((x, y) => x.d - y.d)
    .slice(0, MAX)
    .map(({ a }): NearbyItem => {
      const entity = { kind: "article", id: String(a.id), data: a } as const;
      return {
        id: String(a.id),
        title: a.title,
        detail: a.description ?? "Wikipedia article",
        kind: "see",
        at: { lat: a.lat, lon: a.lon },
        icon: Landmark,
        tone: "fog",
        ...(a.thumbnail ? { image: a.thumbnail } : {}),
        entity,
        primary: { label: "Read", run: () => profile.open(entity) },
        more: [{ label: "Walk there", run: () => import("../city/client").then((m) => m.routeTo({ lat: a.lat, lon: a.lon, name: a.title }, "foot")) }],
      };
    });
}

/** Wikipedia's places near you, from the same route and hour-long cache as the map layer. */
const nearby: NearbyProvider = async ({ at, radiusM }, signal) => articleItems(await fetchArticlesNear(at, Math.min(radiusM, 10_000), signal), at, radiusM);
export default nearby;
