import { Landmark } from "lucide-react";
import type { ExpressionSpecification } from "maplibre-gl";
import { useEffect, useMemo } from "react";
import { usePoll } from "../../app/core/hooks";
import { profile, useProfile } from "../../app/core/profile";
import { distanceM } from "../../shared/geo";
import { MAP_INK, ringIcon, useGeoJsonLayer, useMapIcon, useMapView, type MapLayerProps } from "../city/extension";
import { fetchArticlesNear } from "./client";

const INK: ExpressionSpecification = ["case", ["get", "selected"], MAP_INK.ice, MAP_INK.bone];

/** Wikipedia articles near the map centre, as landmark marks that open the article's story. */
export default function PlacesLayer({ map, report }: MapLayerProps): null {
  const view = useMapView(map);
  const radius = Math.min(10_000, distanceM(view.center, { lat: view.north, lon: view.east }));
  const key = `${view.center.lat.toFixed(3)},${view.center.lon.toFixed(3)},${Math.round(radius / 500)}`;
  const { data, error, loading } = usePoll((signal) => fetchArticlesNear(view.center, radius, signal), null, [key]);
  const selected = useProfile((s) => (s.entity?.kind === "article" ? s.entity.id : null));
  const icon = useMapIcon(map, "places-landmark", Landmark);
  useEffect(() => report({ loading: loading && !data, error: error?.message ?? null, count: data?.length ?? null }), [report, data, error, loading]);

  const points = useMemo(
    (): GeoJSON.FeatureCollection | null =>
      data && icon
        ? {
            type: "FeatureCollection",
            features: data.map((a) => ({ type: "Feature", properties: { id: a.id, title: a.title, selected: String(a.id) === selected }, geometry: { type: "Point", coordinates: [a.lon, a.lat] } })),
          }
        : null,
    [data, icon, selected],
  );

  useGeoJsonLayer(map, {
    id: "places-articles",
    data: points,
    fadeBy: "id",
    clickable: ["places-articles-ring"],
    onClick: (f) => {
      const a = data?.find((x) => x.id === Number(f.properties.id));
      if (a) profile.open({ kind: "article", id: String(a.id), data: a });
    },
    layers: (source) => [
      {
        id: `${source}-ring`,
        type: "circle",
        source,
        paint: {
          "circle-radius": ["case", ["get", "selected"], 9, 7.5],
          "circle-color": MAP_INK.void,
          "circle-stroke-color": INK,
          "circle-stroke-width": 1.5,
        },
      },
      ringIcon(source, { icon: "places-landmark", color: INK, px: 10 }),
      {
        id: `${source}-label`,
        type: "symbol",
        source,
        minzoom: 15,
        layout: { "text-field": ["get", "title"], "text-font": ["Noto Sans Regular"], "text-size": 10.5, "text-offset": [0, 1.2], "text-anchor": "top", "text-max-width": 10, "text-optional": true },
        paint: { "text-color": MAP_INK.fog, "text-halo-color": MAP_INK.void, "text-halo-width": 1.3 },
      },
    ],
  });
  return null;
}
