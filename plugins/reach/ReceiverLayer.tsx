import { Radio } from "lucide-react";
import type { ExpressionSpecification } from "maplibre-gl";
import { useEffect, useMemo } from "react";
import { profile, useProfile } from "../../app/core/profile";
import { MAP_INK, ringIcon, useGeoJsonLayer, useMapIcon, type MapLayerProps } from "../city/extension";
import { useReceivers } from "./client";
import { isFull, loadOf } from "./types";

/** Thousands of these span the world: far out they are plain rings, and the icon appears from here. */
const ICON_ZOOM = 5;
const INK: ExpressionSpecification = ["case", ["get", "selected"], MAP_INK.ice, ["get", "full"], MAP_INK.ash, MAP_INK.sodium];

/** Public radio receivers. Each glows brighter with more listeners; a full one turns grey because nobody else can join. */
export default function ReceiverLayer({ map, report }: MapLayerProps): null {
  const { data, error, loading } = useReceivers();
  const selected = useProfile((s) => (s.entity?.kind === "receiver" ? s.entity.id : null));
  const icon = useMapIcon(map, "reach-radio", Radio);
  useEffect(() => report({ loading: loading && !data, error: error?.message ?? null, count: data?.receivers.length ?? null }), [report, data, error, loading]);

  const points = useMemo(
    (): GeoJSON.FeatureCollection | null =>
      data && icon
        ? {
            type: "FeatureCollection",
            features: data.receivers.map((r) => ({
              type: "Feature",
              properties: { id: r.id, load: loadOf(r), full: isFull(r), selected: r.id === selected },
              geometry: { type: "Point", coordinates: [r.lon, r.lat] },
            })),
          }
        : null,
    [data, icon, selected],
  );

  useGeoJsonLayer(map, {
    id: "reach-receivers",
    data: points,
    fadeBy: "id",
    clickable: ["reach-receivers-ring"],
    onClick: (f) => {
      const r = data?.receivers.find((x) => x.id === f.properties.id);
      if (r) profile.open({ kind: "receiver", id: r.id, data: r });
    },
    layers: (source) => [
      {
        id: `${source}-glow`,
        type: "circle",
        source,
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["get", "load"], 0, 7, 1, 18],
          "circle-color": ["case", ["get", "full"], MAP_INK.ash, MAP_INK.sodium],
          "circle-opacity": ["interpolate", ["linear"], ["get", "load"], 0, 0.06, 1, 0.26],
          "circle-blur": 0.9,
          "circle-pitch-alignment": "map",
        },
      },
      {
        id: `${source}-ring`,
        type: "circle",
        source,
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], ICON_ZOOM - 2, ["case", ["get", "selected"], 6, 3.5], ICON_ZOOM, ["case", ["get", "selected"], 9, 7.5]],
          "circle-color": MAP_INK.void,
          "circle-stroke-color": INK,
          "circle-stroke-width": 1.5,
        },
      },
      ringIcon(source, { icon: "reach-radio", color: INK, minzoom: ICON_ZOOM - 1, px: [[ICON_ZOOM - 1, 7], [ICON_ZOOM, 10]] }),
    ],
  });
  return null;
}
