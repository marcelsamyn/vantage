import { Bike } from "lucide-react";
import type { ExpressionSpecification } from "maplibre-gl";
import { useEffect, useMemo } from "react";
import { usePoll } from "../../app/core/hooks";
import { profile, useProfile } from "../../app/core/profile";
import { MAP_INK, ringIcon, useGeoJsonLayer, useMapIcon, useMapView, type MapLayerProps } from "../city/extension";
import { fetchBikes } from "./client";

const INK: ExpressionSpecification = ["case", ["get", "selected"], MAP_INK.ice, ["match", ["get", "state"], 0, MAP_INK.alarm, 1, MAP_INK.sodium, MAP_INK.mint]];

/** Live bike-share stations: mint with bikes to spare, sodium when few are left, alarm when empty. */
export default function BikeLayer({ map, report }: MapLayerProps): null {
  const view = useMapView(map);
  const key = `${view.center.lat.toFixed(2)},${view.center.lon.toFixed(2)}`;
  const { data, error, loading } = usePoll((signal) => fetchBikes(view.center, signal), 60_000, [key]);
  const selected = useProfile((s) => (s.entity?.kind === "bikestation" ? s.entity.id : null));
  const icon = useMapIcon(map, "bikes-bike", Bike);
  useEffect(
    () => report({ loading: loading && !data, error: error?.message ?? null, count: data?.stations.length ?? null }),
    [report, data, error, loading],
  );
  const names = useMemo(() => new Map(data?.networks.map((n) => [n.id, n.name]) ?? []), [data]);

  const points = useMemo(
    (): GeoJSON.FeatureCollection | null =>
      data && icon
        ? {
            type: "FeatureCollection",
            features: data.stations.map((s) => ({
              type: "Feature",
              properties: { id: s.id, bikes: s.bikes, label: String(s.bikes), state: !s.renting || s.bikes === 0 ? 0 : s.bikes < 3 ? 1 : 2, selected: s.id === selected },
              geometry: { type: "Point", coordinates: [s.lon, s.lat] },
            })),
          }
        : null,
    [data, icon, selected],
  );

  useGeoJsonLayer(map, {
    id: "bikes-stations",
    data: points,
    fadeBy: "id",
    clickable: ["bikes-stations-dot"],
    onClick: (f) => {
      const s = data?.stations.find((x) => x.id === f.properties.id);
      if (s) profile.open({ kind: "bikestation", id: s.id, data: { ...s, networkName: names.get(s.network) ?? s.network } });
    },
    layers: (source) => [
      {
        id: `${source}-dot`,
        type: "circle",
        source,
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 12, 3, 16, 9],
          "circle-color": MAP_INK.void,
          "circle-stroke-width": ["case", ["get", "selected"], 2.5, 1.6],
          "circle-stroke-color": INK,
        },
      },
      ringIcon(source, {
        icon: "bikes-bike",
        color: INK,
        minzoom: 13,
        px: [[13, 7], [16, 12]],
      }),
      {
        id: `${source}-count`,
        type: "symbol",
        source,
        minzoom: 15,
        layout: { "text-field": ["get", "label"], "text-font": ["Noto Sans Regular"], "text-size": 10, "text-offset": [0, 1.3], "text-anchor": "top", "text-allow-overlap": true },
        paint: { "text-color": MAP_INK.bone, "text-halo-color": MAP_INK.void, "text-halo-width": 1.2 },
      },
    ],
  });
  return null;
}
