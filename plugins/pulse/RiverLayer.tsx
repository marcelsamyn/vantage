import { useEffect, useMemo } from "react";
import { profile, useProfile } from "../../app/core/profile";
import { MAP_INK, useGeoJsonLayer, useMapView, type MapLayerProps } from "../city/extension";
import { useRivers } from "./client";
import { RIVER_BADGES, riverIcon, useBadges } from "./icons";
import { levelText } from "./words";


/** River gauges, ringed by how their level compares with the thresholds their source publishes. */
export default function RiverLayer({ map, report }: MapLayerProps): null {
  const view = useMapView(map);
  const { data, error, loading } = useRivers(view);
  const ready = useBadges(map, RIVER_BADGES);
  const selected = useProfile((s) => (s.entity?.kind === "rivergauge" ? s.entity.id : null));
  const gauges = useMemo(() => data?.gauges ?? [], [data]);
  const byId = useMemo(() => new Map(gauges.map((g) => [g.id, g])), [gauges]);

  const points = useMemo(
    (): GeoJSON.FeatureCollection | null =>
      ready
        ? {
            type: "FeatureCollection",
            features: gauges.map((g) => ({
              type: "Feature",
              properties: { id: g.id, icon: riverIcon(g.status), label: g.level === null ? "" : levelText(g.level), sel: g.id === selected },
              geometry: { type: "Point", coordinates: [g.lon, g.lat] },
            })),
          }
        : null,
    [ready, gauges, selected],
  );

  useGeoJsonLayer(map, {
    id: "pulse-rivers",
    data: points,
    fadeBy: "id",
    clickable: ["pulse-rivers-badge"],
    onClick: (f) => {
      const gauge = byId.get(String(f.properties.id));
      if (gauge) profile.open({ kind: "rivergauge", id: gauge.id, data: { gauge } });
    },
    layers: (source) => [
      { id: `${source}-sel`, type: "circle", source, filter: ["get", "sel"], paint: { "circle-radius": 19, "circle-color": MAP_INK.ice, "circle-opacity": 0.12, "circle-stroke-color": MAP_INK.ice, "circle-stroke-width": 1 } },
      {
        id: `${source}-badge`,
        type: "symbol",
        source,
        layout: { "icon-image": ["get", "icon"], "icon-size": ["interpolate", ["linear"], ["zoom"], 10, 0.55, 14, 0.8, 17, 1], "icon-allow-overlap": true, "icon-ignore-placement": true },
      },
      {
        id: `${source}-label`,
        type: "symbol",
        source,
        minzoom: 11.5,
        layout: { "text-field": ["get", "label"], "text-font": ["Noto Sans Regular"], "text-size": 10.5, "text-offset": [0, 1.4], "text-anchor": "top", "text-letter-spacing": 0.04, "text-optional": true },
        paint: { "text-color": MAP_INK.bone, "text-halo-color": MAP_INK.void, "text-halo-width": 1.3 },
      },
    ],
  });

  useEffect(() => {
    const partial = data && data.errors.length > 0 ? data.errors.join("; ") : null;
    report({ loading: loading && !data, error: error?.message ?? partial, count: gauges.length });
  }, [report, loading, data, error, gauges.length]);
  return null;
}
