import { Cctv } from "lucide-react";
import type { NearbyItem, NearbyProvider } from "../../app/core/nearby";
import { profile } from "../../app/core/profile";
import { compassPoint, distanceM, type LatLon } from "../../shared/geo";
import { loadTile, tilesFor } from "./client";
import { DESCRIBE } from "./describe";
import type { GridFeature } from "./types";

/** Cameras within a short walk; the street grid is loaded in zoom-14 tiles that the browser keeps for the session. */
const REACH_M = 500;
/** The nearest few: a busy square has dozens, and the map shows them all with their view cones. */
const MAX = 3;

/** The surveillance cameras nearest to you, nearest first. Exported on its own, so a test can feed it recorded tiles. */
export function cameraItems(features: readonly GridFeature[], at: LatLon, reachM: number): NearbyItem[] {
  return features
    .flatMap((f) => {
      if (f.properties.kind !== "camera" || f.geometry.type !== "Point") return [];
      const [lon, lat] = f.geometry.coordinates;
      if (lon === undefined || lat === undefined) return [];
      const d = distanceM(at, { lat, lon });
      return d <= reachM ? [{ f, lat, lon, d }] : [];
    })
    .sort((a, b) => a.d - b.d)
    .slice(0, MAX)
    .map(({ f, lat, lon }): NearbyItem => {
      const ref = { ...f.properties, lat, lon };
      const entity = { kind: "grid", id: f.properties.osm, data: ref } as const;
      const operator = f.properties.tags.operator;
      const watching = f.properties.directions.length > 0 ? `watching ${f.properties.directions.map((d) => compassPoint(d)).join(", ")}` : null;
      return {
        id: f.properties.osm,
        title: f.properties.name ?? DESCRIBE.camera.band,
        detail: [operator, watching].filter(Boolean).join(" · ") || DESCRIBE.camera.band,
        kind: "see",
        at: { lat, lon },
        icon: Cctv,
        tone: "alarm",
        entity,
        primary: { label: "Show it", run: () => profile.open(entity) },
      };
    });
}

/** Surveillance cameras mapped in OpenStreetMap, from the same tiles the camera layer draws. */
const nearby: NearbyProvider = async ({ at, radiusM }, signal) => {
  const reach = Math.min(radiusM, REACH_M);
  const dLat = reach / 111_320;
  const dLon = reach / (111_320 * Math.cos((at.lat * Math.PI) / 180));
  const settled = await Promise.allSettled(tilesFor({ west: at.lon - dLon, south: at.lat - dLat, east: at.lon + dLon, north: at.lat + dLat }).map((t) => loadTile(t.x, t.y, signal)));
  signal.throwIfAborted();
  // A tile that failed leaves a gap; only when every tile failed is there nothing to say.
  const features = settled.flatMap((r) => (r.status === "fulfilled" ? r.value.features : []));
  const failure = settled.find((r): r is PromiseRejectedResult => r.status === "rejected");
  if (failure && settled.every((r) => r.status === "rejected")) throw failure.reason;
  return cameraItems(features, at, reach);
};
export default nearby;
