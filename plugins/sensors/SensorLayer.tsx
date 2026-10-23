import { Radiation, Volume2, Wind, type LucideIcon } from "lucide-react";
import type { ExpressionSpecification } from "maplibre-gl";
import { useEffect, useMemo } from "react";
import { usePoll } from "../../app/core/hooks";
import { profile, useProfile } from "../../app/core/profile";
import { distanceM } from "../../shared/geo";
import { MAP_INK, ringIcon, useGeoJsonLayer, useMapIcon, useMapView, type MapLayerProps } from "../city/extension";
import { fetchSensors, showValue } from "./client";
import type { SensorKind } from "./types";

const MAX_RADIUS_KM: Record<SensorKind, number> = { air: 25, noise: 4000, radiation: 4000 };
const ICON: Record<SensorKind, LucideIcon> = { air: Wind, noise: Volume2, radiation: Radiation };

/** Sensors of one kind in the visible area: a ring coloured by what the reading means, with the value at street level. */
export function SensorLayer({ kind, map, report }: MapLayerProps & { kind: SensorKind }): null {
  const view = useMapView(map);
  const radiusKm = Math.min(MAX_RADIUS_KM[kind], Math.max(5, (distanceM(view.center, { lat: view.north, lon: view.east }) / 1000) * 1.1));
  // Round so a small pan reuses the same request; the server caches by the same rounding.
  const key = `${kind}:${view.center.lat.toFixed(1)},${view.center.lon.toFixed(1)},${Math.round(radiusKm / 10)}`;
  const { data, error, loading } = usePoll((signal) => fetchSensors(kind, view.center, radiusKm, signal), 90_000, [key]);
  const selected = useProfile((s) => (s.entity?.kind === "sensor" ? s.entity.id : null));
  const icon = useMapIcon(map, `sensors-${kind}`, ICON[kind]);
  // A network that is down is worth saying only when it leaves the map empty.
  const sourceProblem = data && data.sensors.length === 0 ? data.sources.filter((s) => !s.ok).map((s) => `${s.id}: ${s.error}`).join("; ") : "";
  useEffect(() => report({ loading: loading && !data, error: error?.message ?? (sourceProblem || null), count: data?.sensors.length ?? null }), [report, data, error, loading, sourceProblem]);

  const points = useMemo(
    (): GeoJSON.FeatureCollection | null =>
      data && icon
        ? {
            type: "FeatureCollection",
            features: data.sensors.map((s) => ({
              type: "Feature",
              properties: { id: s.id, level: s.level, live: s.live, label: showValue(s), selected: s.id === selected },
              geometry: { type: "Point", coordinates: [s.lon, s.lat] },
            })),
          }
        : null,
    [data, icon, selected],
  );

  const levelColor: ExpressionSpecification = ["match", ["get", "level"], "fine", MAP_INK.mint, "elevated", MAP_INK.sodium, MAP_INK.alarm];

  useGeoJsonLayer(map, {
    id: `sensors-${kind}`,
    data: points,
    fadeBy: "id",
    clickable: [`sensors-${kind}-dot`],
    onClick: (f) => {
      const s = data?.sensors.find((x) => x.id === f.properties.id);
      if (s) profile.open({ kind: "sensor", id: s.id, data: s });
    },
    layers: (source) => [
      {
        id: `${source}-dot`,
        type: "circle",
        source,
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 3, 3, 9, 6, 14, 11],
          "circle-color": ["case", ["get", "live"], levelColor, MAP_INK.void],
          "circle-opacity": ["case", ["get", "live"], 0.85, 0.35],
          "circle-stroke-color": ["case", ["get", "selected"], MAP_INK.ice, levelColor],
          "circle-stroke-width": ["case", ["get", "selected"], 2.5, 1.5],
        },
      },
      // Dark on a live sensor's filled disc, in the level's colour inside a stale one's ring.
      ringIcon(source, { icon: `sensors-${kind}`, color: ["case", ["get", "live"], MAP_INK.void, levelColor], minzoom: 8, px: [[8, 7], [14, 14]] }),
      {
        id: `${source}-value`,
        type: "symbol",
        source,
        minzoom: 11,
        layout: { "text-field": ["get", "label"], "text-font": ["Noto Sans Regular"], "text-size": 10, "text-offset": [0, 1.5], "text-anchor": "top", "text-optional": true },
        paint: { "text-color": MAP_INK.bone, "text-halo-color": MAP_INK.void, "text-halo-width": 1.2 },
      },
    ],
  });

  return null;
}
