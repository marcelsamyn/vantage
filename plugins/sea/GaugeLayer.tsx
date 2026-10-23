import { useEffect, useMemo } from "react";
import { usePoll } from "../../app/core/hooks";
import { profile, useProfile } from "../../app/core/profile";
import { MAP_INK, useGeoJsonLayer, useMapPulse, useMapView, type MapLayerProps } from "../city/extension";
import { fetchGauges } from "./client";
import { useSettled } from "./useSettled";

const PULSE_MS = 1400;
/** Each paint write makes the map repaint; about 30 a second looks smooth for a slow ripple. */
/** Round the view outward so a small pan reuses the same request. */
const SNAP = 2;
/** Below this zoom a view spans a continent and the gauges nearest its centre say little, so levels are not judged. */
const JUDGE_FROM_ZOOM = 5;

/** Tide gauges as dots: calm gauges sit quietly, restless ones get a ring, and ones swinging far beyond their norm pulse red. */
export default function GaugeLayer({ map, report }: MapLayerProps): null {
  const view = useSettled(useMapView(map), 700);
  const snap = (v: number, up: boolean): number => (up ? Math.ceil(v / SNAP) * SNAP : Math.floor(v / SNAP) * SNAP);
  const box = { west: Math.max(-180, snap(view.west, false)), south: Math.max(-90, snap(view.south, false)), east: Math.min(180, snap(view.east, true)), north: Math.min(90, snap(view.north, true)) };
  const key = `${box.west},${box.south},${box.east},${box.north}`;
  const plain = usePoll((signal) => fetchGauges(box, false, signal), 3 * 60_000, [key]);
  // Judging a gauge reads its last 24 hours, so it comes as a second, slower request and the dots appear first.
  const judged = usePoll((signal) => fetchGauges(box, true, signal), 5 * 60_000, [key], view.zoom < JUDGE_FROM_ZOOM);
  const selected = useProfile((s) => (s.entity?.kind === "tidegauge" ? s.entity.id : null));
  const error = plain.error ?? judged.error;
  useEffect(() => report({ loading: plain.loading && !plain.data, error: plain.data ? null : (error?.message ?? null), count: plain.data?.length ?? null }), [report, plain.data, plain.loading, error]);

  const points = useMemo((): GeoJSON.FeatureCollection | null => {
    if (!plain.data) return null;
    const levels = new Map(judged.data?.map((g) => [g.code, g.level]));
    return {
      type: "FeatureCollection",
      features: plain.data.map((g) => ({
        type: "Feature",
        properties: { code: g.code, label: g.name, level: levels.get(g.code) ?? "unjudged", selected: g.code === selected },
        geometry: { type: "Point", coordinates: [g.lon, g.lat] },
      })),
    };
  }, [plain.data, judged.data, selected]);

  useGeoJsonLayer(map, {
    id: "sea-gauges",
    data: points,
    fadeBy: "code",
    clickable: ["sea-gauges-dot"],
    onClick: (f) => {
      const g = plain.data?.find((x) => x.code === f.properties.code);
      const level = judged.data?.find((x) => x.code === f.properties.code)?.level ?? null;
      if (g) profile.open({ kind: "tidegauge", id: g.code, data: { ...g, level } });
    },
    layers: (source) => [
      {
        id: `${source}-pulse`,
        type: "circle",
        source,
        filter: ["==", ["get", "level"], "unusual"],
        paint: { "circle-radius": 8, "circle-color": "rgba(0,0,0,0)", "circle-stroke-color": MAP_INK.alarm, "circle-stroke-width": 1.5, "circle-stroke-opacity": 0.8 },
      },
      {
        id: `${source}-ring`,
        type: "circle",
        source,
        filter: ["any", ["==", ["get", "level"], "restless"], ["==", ["get", "level"], "unusual"]],
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 3, 6, 10, 10],
          "circle-color": "rgba(0,0,0,0)",
          "circle-stroke-color": ["match", ["get", "level"], "unusual", MAP_INK.alarm, MAP_INK.sodium],
          "circle-stroke-width": 1.5,
          "circle-stroke-opacity": 0.85,
        },
      },
      {
        id: `${source}-halo`,
        type: "circle",
        source,
        filter: ["get", "selected"],
        paint: { "circle-radius": 14, "circle-color": MAP_INK.ice, "circle-opacity": 0.14, "circle-stroke-color": MAP_INK.ice, "circle-stroke-width": 1, "circle-stroke-opacity": 0.7 },
      },
      {
        id: `${source}-dot`,
        type: "circle",
        source,
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 3, 2.5, 10, 5],
          "circle-color": ["case", ["get", "selected"], MAP_INK.ice, ["==", ["get", "level"], "unusual"], MAP_INK.alarm, MAP_INK.sodium],
          "circle-opacity": ["match", ["get", "level"], "unjudged", 0.55, "normal", 0.8, 1],
          "circle-stroke-color": MAP_INK.void,
          "circle-stroke-width": 1,
        },
      },
      {
        id: `${source}-label`,
        type: "symbol",
        source,
        minzoom: 7,
        layout: { "text-field": ["get", "label"], "text-font": ["Noto Sans Regular"], "text-size": 10, "text-offset": [0, 1.2], "text-anchor": "top", "text-optional": true, "text-max-width": 9 },
        paint: { "text-color": ["case", ["get", "selected"], MAP_INK.ice, MAP_INK.fog], "text-halo-color": MAP_INK.void, "text-halo-width": 1.2 },
      },
    ],
  });

  // Gauges far outside their norm send out a ripple, written straight to the paint properties so React never re-renders for it.
  // Below the judging zoom the dots are not judged, so data from an earlier view must not keep the loop running.
  const alarming = useMemo(() => view.zoom >= JUDGE_FROM_ZOOM && (judged.data?.some((g) => g.level === "unusual") ?? false), [judged.data, view.zoom]);
  useMapPulse(map, "sea-gauges-pulse", PULSE_MS, (phase) => [["circle-radius", 7 + phase * 18], ["circle-stroke-opacity", 0.9 * (1 - phase)]], alarming);

  return null;
}
