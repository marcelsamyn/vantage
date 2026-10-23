import { useEffect } from "react";
import { useNow } from "../../app/core/hooks";
import { profile, useProfile } from "../../app/core/profile";
import { MAP_INK, useGeoJsonLayer, type MapLayerProps } from "../city/extension";
import { useDrones } from "./client";
import { hasRecentPosition, receiverProblem, recentDrones } from "./view";

export default function DroneLayer({ map, report }: MapLayerProps): null {
  const { data, error, loading } = useDrones();
  const now = useNow();
  const selected = useProfile((s) => s.entity?.kind === "drone" ? s.entity.id : null);
  const problem = receiverProblem(data, now);
  const drones = recentDrones(data, now).filter((v) => hasRecentPosition(v, now));
  useEffect(() => report({ loading: loading && !data, error: error?.message ?? problem, count: drones.length }), [report, loading, data, error, problem, drones.length]);
  const points: GeoJSON.FeatureCollection = {
    type: "FeatureCollection", features: drones.map((drone) => ({
      type: "Feature" as const, properties: { id: drone.id, selected: selected === drone.id },
      geometry: { type: "Point" as const, coordinates: [drone.position.lon, drone.position.lat] },
    })),
  };
  useGeoJsonLayer(map, {
    id: "drones-positions", data: points, fadeBy: "id", clickable: ["drones-positions-dot"],
    onClick: (feature) => {
      const drone = drones.find((v) => v.id === feature.properties.id);
      if (drone) profile.open({ kind: "drone", id: drone.id, data: drone });
    },
    layers: (source) => [
      { id: `${source}-dot`, source, type: "circle", paint: { "circle-radius": 6, "circle-color": ["case", ["get", "selected"], MAP_INK.ice, MAP_INK.sodium], "circle-stroke-width": 2, "circle-stroke-color": MAP_INK.void } },
      { id: `${source}-label`, source, type: "symbol", minzoom: 12, layout: { "text-field": ["get", "id"], "text-size": 10, "text-font": ["Noto Sans Regular"], "text-offset": [0, 1.3], "text-anchor": "top" }, paint: { "text-color": MAP_INK.sodium, "text-halo-color": MAP_INK.void, "text-halo-width": 1.2 } },
    ],
  });
  return null;
}
