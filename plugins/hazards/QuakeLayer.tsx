import { useEffect, useMemo } from "react";
import { usePoll } from "../../app/core/hooks";
import { profile, useProfile } from "../../app/core/profile";
import { MAP_INK, useGeoJsonLayer, useMapPulse, type MapLayerProps } from "../city/extension";
import { fetchQuakes } from "./client";

const HOUR = 3_600_000;
/** Only quakes at least this strong from the past hour get the ripple; the layer filter below must agree. */
const PULSE_MIN_MAG = 1.5;
const PULSE_MS = 1000;

/** Earthquakes of the past week from USGS (M2.5+ worldwide), EMSC (M1+ in Europe) and INGV (all of Italy), sized by magnitude; the past hour pulses. */
export default function QuakeLayer({ map, report }: MapLayerProps): null {
  const { data, error, loading } = usePoll((signal) => fetchQuakes("week", signal), 5 * 60_000, []);
  const selected = useProfile((s) => (s.entity?.kind === "quake" ? s.entity.id : null));
  useEffect(() => report({ loading: loading && !data, error: error?.message ?? null, count: data?.length ?? null }), [report, data, error, loading]);

  const points = useMemo((): GeoJSON.FeatureCollection | null => {
    if (!data) return null;
    const now = Date.now();
    return {
      type: "FeatureCollection",
      features: data.map((q) => ({
        type: "Feature",
        properties: { id: q.id, mag: q.mag, label: `M${q.mag.toFixed(1)}`, ageH: (now - q.time) / HOUR, selected: q.id === selected },
        geometry: { type: "Point", coordinates: [q.lon, q.lat] },
      })),
    };
  }, [data, selected]);

  useGeoJsonLayer(map, {
    id: "hazards-quakes",
    data: points,
    fadeBy: "id",
    clickable: ["hazards-quakes-dot"],
    onClick: (f) => {
      const q = data?.find((x) => x.id === f.properties.id);
      if (q) profile.open({ kind: "quake", id: q.id, data: q });
    },
    layers: (source) => [
      {
        id: `${source}-pulse`,
        type: "circle",
        source,
        filter: ["all", ["<", ["get", "ageH"], 1], [">=", ["get", "mag"], PULSE_MIN_MAG]],
        paint: { "circle-radius": 10, "circle-color": "rgba(0,0,0,0)", "circle-stroke-color": MAP_INK.alarm, "circle-stroke-width": 1.5, "circle-stroke-opacity": 0.8 },
      },
      {
        id: `${source}-dot`,
        type: "circle",
        source,
        paint: {
          "circle-radius": ["interpolate", ["exponential", 1.6], ["get", "mag"], 0, 1.6, 2.5, 3, 5, 9, 7, 22, 9, 40],
          "circle-color": ["case", ["get", "selected"], MAP_INK.ice, MAP_INK.alarm],
          "circle-opacity": ["interpolate", ["linear"], ["get", "ageH"], 0, 0.75, 24, 0.45, 168, 0.18],
          "circle-stroke-color": ["case", ["get", "selected"], MAP_INK.ice, MAP_INK.alarm],
          "circle-stroke-width": 1,
          "circle-stroke-opacity": 0.8,
        },
      },
      {
        id: `${source}-label`,
        type: "symbol",
        source,
        filter: [">=", ["get", "mag"], 4.5],
        layout: { "text-field": ["get", "label"], "text-font": ["Noto Sans Regular"], "text-size": 10, "text-offset": [0, 1.3], "text-anchor": "top" },
        paint: { "text-color": MAP_INK.alarm, "text-halo-color": MAP_INK.void, "text-halo-width": 1.2 },
      },
    ],
  });

  // The past hour's quakes ripple outward, written straight to the paint properties so React never re-renders for it.
  const pulsing = useMemo(() => data?.some((q) => q.mag >= PULSE_MIN_MAG && Date.now() - q.time < HOUR) ?? false, [data]);
  useMapPulse(map, "hazards-quakes-pulse", PULSE_MS, (phase) => [["circle-radius", 6 + phase * 26], ["circle-stroke-opacity", 0.9 * (1 - phase)]], pulsing);

  return null;
}
