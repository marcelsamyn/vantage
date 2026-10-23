import { Wrench } from "lucide-react";
import type { ExpressionSpecification } from "maplibre-gl";
import { useEffect, useMemo } from "react";
import { distanceM } from "../../shared/geo";
import { profile, useProfile } from "../../app/core/profile";
import { MAP_INK, ringIcon, useGeoJsonLayer, useMapIcon, useMapView, type MapLayerProps } from "../city/extension";
import { useOrders } from "./client";

const INK: ExpressionSpecification = ["case", ["get", "selected"], MAP_INK.ice, ["get", "acknowledged"], MAP_INK.fog, MAP_INK.bone];

/** Open reports near the map centre, as wrench marks that open the work order. Acknowledged ones are dimmer. */
export default function OrderLayer({ map, report }: MapLayerProps): null {
  const view = useMapView(map);
  const radiusKm = Math.min(25, Math.max(2, Math.ceil(distanceM(view.center, { lat: view.north, lon: view.east }) / 1000)));
  const { data, error, loading } = useOrders(view.center, radiusKm);
  const selected = useProfile((s) => (s.entity?.kind === "workorder" ? s.entity.id : null));
  const icon = useMapIcon(map, "reach-order", Wrench);
  const noService = data !== undefined && data.sources.every((s) => s.error !== null);
  useEffect(
    () => report({ loading: loading && !data, error: error?.message ?? (noService ? "No reporting service answered for this area." : null), count: data?.orders.length ?? null }),
    [report, data, error, loading, noService],
  );

  const points = useMemo(
    (): GeoJSON.FeatureCollection | null =>
      data && icon
        ? {
            type: "FeatureCollection",
            features: data.orders.map((o) => ({
              type: "Feature",
              properties: { id: o.id, category: o.category, acknowledged: o.status === "acknowledged", selected: o.id === selected },
              geometry: { type: "Point", coordinates: [o.lon, o.lat] },
            })),
          }
        : null,
    [data, icon, selected],
  );

  useGeoJsonLayer(map, {
    id: "reach-orders",
    data: points,
    fadeBy: "id",
    clickable: ["reach-orders-dot"],
    onClick: (f) => {
      const o = data?.orders.find((x) => x.id === f.properties.id);
      if (o) profile.open({ kind: "workorder", id: o.id, data: o });
    },
    layers: (source) => [
      {
        id: `${source}-dot`,
        type: "circle",
        source,
        paint: {
          "circle-radius": ["case", ["get", "selected"], 9, 7.5],
          "circle-color": MAP_INK.void,
          "circle-stroke-color": INK,
          "circle-stroke-width": 1.5,
        },
      },
      ringIcon(source, { icon: "reach-order", color: INK, px: 10 }),
      {
        id: `${source}-label`,
        type: "symbol",
        source,
        minzoom: 15,
        layout: { "text-field": ["get", "category"], "text-font": ["Noto Sans Regular"], "text-size": 10.5, "text-offset": [0, 1.3], "text-anchor": "top", "text-max-width": 9, "text-optional": true },
        paint: { "text-color": MAP_INK.fog, "text-halo-color": MAP_INK.void, "text-halo-width": 1.3 },
      },
    ],
  });
  return null;
}
