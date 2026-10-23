import { useEffect, useMemo } from "react";
import { usePoll } from "../../app/core/hooks";
import { profile, useProfile } from "../../app/core/profile";
import { MAP_INK, useGeoJsonLayer, useMapView, type MapLayerProps } from "../city/extension";
import { fetchArgo, fetchArgoProfile } from "./client";
import { useSettled } from "./useSettled";

const DAY_MS = 86_400_000;
const SNAP = 4;
/** The server refuses larger areas; a wide window is trimmed around its centre. */
const MAX_SPAN = { lon: 76, lat: 46 };

/** Argo floats whose last dive ended in view, fading as the dive gets older; the selected float also shows the path it drifted. */
export default function ArgoLayer({ map, report }: MapLayerProps): null {
  const view = useSettled(useMapView(map), 700);
  const halfLon = Math.min((view.east - view.west) / 2, MAX_SPAN.lon / 2);
  const halfLat = Math.min((view.north - view.south) / 2, MAX_SPAN.lat / 2);
  const snap = (v: number, up: boolean): number => (up ? Math.ceil(v / SNAP) * SNAP : Math.floor(v / SNAP) * SNAP);
  const box = {
    west: Math.max(-180, snap(view.center.lon - halfLon, false)),
    south: Math.max(-90, snap(view.center.lat - halfLat, false)),
    east: Math.min(180, snap(view.center.lon + halfLon, true)),
    north: Math.min(90, snap(view.center.lat + halfLat, true)),
  };
  const key = `${box.west},${box.south},${box.east},${box.north}`;
  const { data, error, loading } = usePoll((signal) => fetchArgo(box, signal), 30 * 60_000, [key]);
  const selected = useProfile((s) => (s.entity?.kind === "argo" ? s.entity.id : null));
  const path = usePoll((signal) => fetchArgoProfile(selected ?? "", signal), null, [selected], !selected);
  useEffect(() => report({ loading: loading && !data, error: error?.message ?? null, count: data?.length ?? null }), [report, data, error, loading]);

  const points = useMemo((): GeoJSON.FeatureCollection | null => {
    if (!data) return null;
    const now = Date.now();
    return {
      type: "FeatureCollection",
      features: data.map((f) => ({
        type: "Feature",
        properties: { platform: f.platform, ageDays: (now - f.time) / DAY_MS, selected: f.platform === selected },
        geometry: { type: "Point", coordinates: [f.lon, f.lat] },
      })),
    };
  }, [data, selected]);

  const drift = useMemo((): GeoJSON.FeatureCollection | null => {
    const p = selected && path.data?.platform === selected ? path.data : null;
    if (!p) return null;
    const stops = [...p.history, p.latest];
    return {
      type: "FeatureCollection",
      features: [
        { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: stops.map((s) => [s.lon, s.lat]) } },
        ...stops.map((s) => ({ type: "Feature" as const, properties: { cycle: s.cycle }, geometry: { type: "Point" as const, coordinates: [s.lon, s.lat] } })),
      ],
    };
  }, [selected, path.data]);

  useGeoJsonLayer(map, {
    id: "sea-argo-drift",
    data: drift,
    belowLabels: true,
    layers: (source) => [
      { id: `${source}-line`, type: "line", source, filter: ["==", ["geometry-type"], "LineString"], layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": MAP_INK.ice, "line-width": 1.5, "line-dasharray": [2, 2], "line-opacity": 0.85 } },
      { id: `${source}-stop`, type: "circle", source, filter: ["==", ["geometry-type"], "Point"], paint: { "circle-radius": 2.5, "circle-color": MAP_INK.ice, "circle-opacity": 0.8 } },
    ],
  });

  useGeoJsonLayer(map, {
    id: "sea-argo",
    data: points,
    fadeBy: "platform",
    clickable: ["sea-argo-dot"],
    onClick: (f) => {
      const float = data?.find((x) => x.platform === f.properties.platform);
      if (float) profile.open({ kind: "argo", id: float.platform, data: float });
    },
    layers: (source) => [
      {
        id: `${source}-halo`,
        type: "circle",
        source,
        filter: ["get", "selected"],
        paint: { "circle-radius": 14, "circle-color": MAP_INK.ice, "circle-opacity": 0.14, "circle-stroke-color": MAP_INK.ice, "circle-stroke-width": 1, "circle-stroke-opacity": 0.7 },
      },
      {
        id: `${source}-ring`,
        type: "circle",
        source,
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, 5, 10, 9],
          "circle-color": "rgba(0,0,0,0)",
          "circle-stroke-color": ["case", ["get", "selected"], MAP_INK.ice, MAP_INK.bone],
          "circle-stroke-width": 1,
          "circle-stroke-opacity": ["interpolate", ["linear"], ["get", "ageDays"], 0, 0.9, 21, 0.3],
        },
      },
      {
        id: `${source}-dot`,
        type: "circle",
        source,
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, 2, 10, 3.5],
          "circle-color": ["case", ["get", "selected"], MAP_INK.ice, MAP_INK.bone],
          "circle-opacity": ["interpolate", ["linear"], ["get", "ageDays"], 0, 1, 21, 0.4],
        },
      },
    ],
  });

  return null;
}
