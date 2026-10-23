import { SatelliteDish } from "lucide-react";
import type { ExpressionSpecification } from "maplibre-gl";
import { useEffect, useMemo } from "react";
import { profile, useProfile } from "../../app/core/profile";
import { MAP_INK, ringIcon, useGeoJsonLayer, useMapIcon, type MapLayerProps } from "../city/extension";
import { useStations } from "./client";

/** Thousands of these span the world: far out they are plain rings, and the icon appears from here. */
const ICON_ZOOM = 5;
const INK: ExpressionSpecification = ["case", ["get", "selected"], MAP_INK.ice, ["get", "online"], MAP_INK.mint, MAP_INK.fog];

/** SatNOGS ground stations. Online stations are mint, stations still being tested are grey, and a ring marks one recording a pass. */
export default function StationLayer({ map, report }: MapLayerProps): null {
  const { data, error, loading } = useStations();
  const selected = useProfile((s) => (s.entity?.kind === "groundstation" ? s.entity.id : null));
  const icon = useMapIcon(map, "reach-dish", SatelliteDish);
  useEffect(() => report({ loading: loading && !data, error: error?.message ?? null, count: data?.stations.length ?? null }), [report, data, error, loading]);

  const points = useMemo(
    (): GeoJSON.FeatureCollection | null =>
      data && icon
        ? {
            type: "FeatureCollection",
            features: data.stations.map((s) => ({
              type: "Feature",
              properties: { id: String(s.id), name: s.name, online: s.status === "online", observing: s.observing !== null, selected: String(s.id) === selected },
              geometry: { type: "Point", coordinates: [s.lon, s.lat] },
            })),
          }
        : null,
    [data, icon, selected],
  );

  useGeoJsonLayer(map, {
    id: "reach-stations",
    data: points,
    fadeBy: "id",
    clickable: ["reach-stations-dot"],
    onClick: (f) => {
      const s = data?.stations.find((x) => String(x.id) === f.properties.id);
      if (s) profile.open({ kind: "groundstation", id: String(s.id), data: s });
    },
    layers: (source) => [
      {
        id: `${source}-ring`,
        type: "circle",
        source,
        filter: ["get", "observing"],
        paint: { "circle-radius": 13, "circle-color": MAP_INK.sodium, "circle-opacity": 0.1, "circle-stroke-color": MAP_INK.sodium, "circle-stroke-width": 1.2, "circle-stroke-opacity": 0.85, "circle-pitch-alignment": "map" },
      },
      {
        id: `${source}-dot`,
        type: "circle",
        source,
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], ICON_ZOOM - 2, ["case", ["get", "selected"], 6, 3.5], ICON_ZOOM, ["case", ["get", "selected"], 9, 7.5]],
          "circle-color": MAP_INK.void,
          "circle-stroke-color": INK,
          "circle-stroke-width": 1.5,
        },
      },
      ringIcon(source, { icon: "reach-dish", color: INK, minzoom: ICON_ZOOM - 1, px: [[ICON_ZOOM - 1, 7], [ICON_ZOOM, 10]] }),
      {
        id: `${source}-label`,
        type: "symbol",
        source,
        minzoom: 7,
        layout: { "text-field": ["get", "name"], "text-font": ["Noto Sans Regular"], "text-size": 10.5, "text-offset": [0, 1.3], "text-anchor": "top", "text-optional": true },
        paint: { "text-color": MAP_INK.fog, "text-halo-color": MAP_INK.void, "text-halo-width": 1.3 },
      },
    ],
  });
  return null;
}
