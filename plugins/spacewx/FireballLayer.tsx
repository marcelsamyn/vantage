import type { ExpressionSpecification } from "maplibre-gl";
import { useEffect, useMemo } from "react";
import { usePoll } from "../../app/core/hooks";
import { profile, useProfile } from "../../app/core/profile";
import { MAP_INK, useGeoJsonLayer, type MapLayerProps } from "../city/extension";
import { fetchFireballs } from "./client";

const YEAR_MS = 365.25 * 86_400_000;

/** Fireballs recorded by U.S. government sensors, sized by impact energy; recent ones are brighter. */
export default function FireballLayer({ map, report }: MapLayerProps): null {
  const { data, error, loading } = usePoll((signal) => fetchFireballs(signal), 6 * 3_600_000, []);
  const selected = useProfile((s) => (s.entity?.kind === "fireball" ? s.entity.id : null));

  useEffect(() => report({ loading: loading && !data, error: error?.message ?? null, count: data?.length ?? null }), [report, data, error, loading]);

  const points = useMemo((): GeoJSON.FeatureCollection | null => {
    if (!data) return null;
    const now = Date.now();
    return {
      type: "FeatureCollection",
      features: data.map((f) => ({
        type: "Feature",
        properties: { id: f.id, kt: f.kt, ageY: (now - f.at) / YEAR_MS, label: f.kt >= 1 ? `${f.kt >= 10 ? Math.round(f.kt) : f.kt} kt` : "", selected: f.id === selected },
        geometry: { type: "Point", coordinates: [f.lon, f.lat] },
      })),
    };
  }, [data, selected]);

  // Radius grows with the logarithm of the energy: events run from 0.1 kt to over 400 kt. Dots shrink toward world zoom so 900 events stay legible.
  const radiusAt = (scale: number): ExpressionSpecification => ["interpolate", ["linear"], ["ln", ["max", ["get", "kt"], 0.05]], -3, 2.5 * scale, 0, 4.5 * scale, 2.3, 8 * scale, 4.6, 13 * scale, 6.2, 19 * scale];
  const radius: ExpressionSpecification = ["interpolate", ["linear"], ["zoom"], 0, radiusAt(0.5), 5, radiusAt(1)];
  const glowRadius: ExpressionSpecification = ["interpolate", ["linear"], ["zoom"], 0, radiusAt(1), 5, radiusAt(2.2)];
  const colour: ExpressionSpecification = ["case", ["get", "selected"], MAP_INK.ice, MAP_INK.sodium];

  useGeoJsonLayer(map, {
    id: "spacewx-fireballs",
    data: points,
    fadeBy: "id",
    clickable: ["spacewx-fireballs-dot"],
    onClick: (feature) => {
      const f = data?.find((x) => x.id === feature.properties.id);
      if (f) profile.open({ kind: "fireball", id: f.id, data: f });
    },
    layers: (source) => [
      {
        id: `${source}-glow`,
        type: "circle",
        source,
        paint: { "circle-radius": glowRadius, "circle-color": colour, "circle-opacity": ["interpolate", ["linear"], ["get", "ageY"], 0, 0.16, 38, 0.04], "circle-blur": 1 },
      },
      {
        id: `${source}-dot`,
        type: "circle",
        source,
        paint: {
          "circle-radius": radius,
          "circle-color": colour,
          "circle-opacity": ["interpolate", ["linear"], ["get", "ageY"], 0, 0.9, 3, 0.6, 10, 0.32, 38, 0.18],
          "circle-stroke-color": colour,
          "circle-stroke-width": 1,
          "circle-stroke-opacity": 0.85,
        },
      },
      {
        id: `${source}-label`,
        type: "symbol",
        source,
        minzoom: 2,
        filter: [">=", ["get", "kt"], 5],
        layout: { "text-field": ["get", "label"], "text-font": ["Noto Sans Regular"], "text-size": 10, "text-offset": [0, 1.2], "text-anchor": "top", "text-letter-spacing": 0.08 },
        paint: { "text-color": ["case", ["get", "selected"], MAP_INK.ice, MAP_INK.fog], "text-halo-color": MAP_INK.void, "text-halo-width": 1.2 },
      },
    ],
  });

  return null;
}
