import { useEffect, useMemo } from "react";
import { useNow, usePoll } from "../../app/core/hooks";
import { profile } from "../../app/core/profile";
import {
  MAP_INK,
  useGeoJsonLayer,
  useMapView,
  type MapLayerProps,
} from "../city/extension";
import { fetchTrafficPaths, pathFeatures } from "./paths";

export default function TrafficLayer({ map, report }: MapLayerProps): null {
  const box = useMapView(map);
  const { data, error, loading } = usePoll(
    (signal) => fetchTrafficPaths(box, signal),
    60_000,
    [box.west, box.south, box.east, box.north],
  );
  const now = useNow(60_000);
  const features = useMemo(
    () => pathFeatures(data?.events ?? [], now),
    [data, now],
  );
  const byId = useMemo(
    () => new Map((data?.events ?? []).map((e) => [`${e.source}:${e.id}`, e])),
    [data],
  );
  useEffect(
    () =>
      report({
        loading: loading && !data,
        error: error?.message ?? (data?.failed.join("; ") || null),
        count: data ? features.features.length : null,
      }),
    [report, loading, data, error, features.features.length],
  );

  useGeoJsonLayer(map, {
    id: "traffic-paths",
    data: features,
    fadeBy: "id",
    belowLabels: true,
    clickable: ["traffic-paths-line", "traffic-paths-fill"],
    onClick: (f) => {
      const e = byId.get(String(f.properties.id));
      if (e)
        profile.open({
          kind: "roadtraffic",
          id: `${e.source}:${e.id}`,
          data: e,
        });
    },
    layers: (source) => [
      {
        id: `${source}-line`,
        source,
        type: "line",
        paint: {
          "line-color": MAP_INK.sodium,
          "line-width": 4,
          "line-opacity": 0.85,
        },
      },
      {
        id: `${source}-fill`,
        source,
        type: "fill",
        filter: ["==", ["geometry-type"], "Polygon"],
        paint: { "fill-color": MAP_INK.sodium, "fill-opacity": 0.2 },
      },
    ],
  });
  return null;
}
