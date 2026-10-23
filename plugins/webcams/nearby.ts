import { Video } from "lucide-react";
import type { NearbyItem, NearbyProvider } from "../../app/core/nearby";
import { profile } from "../../app/core/profile";
import { distanceM, type LatLon } from "../../shared/geo";
import { fetchNear } from "./client";
import type { Webcam } from "./types";

const MAX = 2;

/** The nearest cameras within the radius, as items that open the camera. */
export function cameraItems(cameras: readonly Webcam[], at: LatLon, radiusM: number): NearbyItem[] {
  return cameras
    .map((c) => ({ c, d: distanceM(at, c) }))
    .filter((x) => x.d <= radiusM)
    .sort((a, b) => a.d - b.d)
    .slice(0, MAX)
    .map(({ c }): NearbyItem => {
      const entity = { kind: "webcam", id: c.id, data: c } as const;
      return {
        id: c.id,
        title: c.name,
        detail: [c.providerName, c.direction && `looking ${c.direction}`, c.stream ? "live video" : `new picture every ${c.refreshS < 120 ? `${c.refreshS} s` : `${Math.round(c.refreshS / 60)} min`}`].filter(Boolean).join(" · "),
        kind: "see",
        at: { lat: c.lat, lon: c.lon },
        icon: Video,
        tone: "sodium",
        live: true,
        image: c.image,
        entity,
        primary: { label: "Watch", run: () => profile.open(entity) },
        more: [{ label: "Camera wall", intent: { screen: "webcams", action: "near" } }],
      };
    });
}

/** The nearest live cameras within reach, from the camera wall's own lookup. Nothing when the wall had to move to another city. */
const nearby: NearbyProvider = async ({ at, radiusM }, signal) => {
  const near = await fetchNear(at, signal);
  return near.moved ? [] : cameraItems(near.cameras, at, radiusM);
};
export default nearby;
