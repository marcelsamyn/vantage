import { useEffect, useMemo } from "react";
import { fmt } from "../../app/core/format";
import { useNow } from "../../app/core/hooks";
import { profile, useProfile } from "../../app/core/profile";
import { MAP_INK, useGeoJsonLayer, useMapPulse, type MapLayerProps } from "../city/extension";
import { useCounters } from "./client";
import { BIKE_BADGES, useBadges } from "./icons";
import type { Counter } from "./types";

/** A bicycle passed within this long: the counter flashes. */
const RECENT_MS = 3 * 60_000;

export function counterLabel(c: Counter): string {
  if (c.hour !== null) return `${fmt.int(c.hour)}/h`;
  return c.day === null ? "" : `${fmt.int(c.day)}/day`;
}

/** Bicycle counters. Brussels counters pulse when a bicycle passes; Ghent shows the latest day its city has published. */
export default function CounterLayer({ map, report }: MapLayerProps): null {
  const { data, error, loading } = useCounters();
  const ready = useBadges(map, BIKE_BADGES);
  const now = useNow(10_000);
  const selected = useProfile((s) => (s.entity?.kind === "counter" ? s.entity.id : null));
  const counters = useMemo(() => data?.counters ?? [], [data]);
  const byId = useMemo(() => new Map(counters.map((c) => [c.id, c])), [counters]);

  const points = useMemo(
    (): GeoJSON.FeatureCollection | null =>
      ready
        ? {
            type: "FeatureCollection",
            features: counters.map((c) => ({
              type: "Feature",
              properties: { id: c.id, icon: c.live ? "pulse-bike-live" : "pulse-bike-latest", label: counterLabel(c), recent: c.live && c.at !== null && now - c.at < RECENT_MS, sel: c.id === selected },
              geometry: { type: "Point", coordinates: [c.lon, c.lat] },
            })),
          }
        : null,
    [ready, counters, now, selected],
  );

  useGeoJsonLayer(map, {
    id: "pulse-counters",
    data: points,
    fadeBy: "id",
    clickable: ["pulse-counters-badge"],
    onClick: (f) => {
      const counter = byId.get(String(f.properties.id));
      if (counter) profile.open({ kind: "counter", id: counter.id, data: { counter } });
    },
    layers: (source) => [
      { id: `${source}-pulse`, type: "circle", source, filter: ["get", "recent"], paint: { "circle-radius": 14, "circle-color": MAP_INK.sodium, "circle-opacity": 0.25, "circle-blur": 0.4 } },
      { id: `${source}-sel`, type: "circle", source, filter: ["get", "sel"], paint: { "circle-radius": 20, "circle-color": MAP_INK.ice, "circle-opacity": 0.12, "circle-stroke-color": MAP_INK.ice, "circle-stroke-width": 1 } },
      {
        id: `${source}-badge`,
        type: "symbol",
        source,
        layout: { "icon-image": ["get", "icon"], "icon-size": ["interpolate", ["linear"], ["zoom"], 10, 0.6, 14, 0.85, 17, 1], "icon-allow-overlap": true, "icon-ignore-placement": true },
      },
      {
        id: `${source}-label`,
        type: "symbol",
        source,
        minzoom: 12.5,
        layout: { "text-field": ["get", "label"], "text-font": ["Noto Sans Regular"], "text-size": 11, "text-offset": [0, 1.5], "text-anchor": "top", "text-letter-spacing": 0.04, "text-optional": true },
        paint: { "text-color": ["case", ["get", "recent"], MAP_INK.sodium, MAP_INK.bone], "text-halo-color": MAP_INK.void, "text-halo-width": 1.3 },
      },
    ],
  });

  // The halo of counters that just registered a bicycle breathes together. With none flashing the map idles.
  const pulsing = counters.some((c) => c.live && c.at !== null && now - c.at < RECENT_MS);
  useMapPulse(map, "pulse-counters-pulse", 1600, (phase) => [["circle-radius", 12 + phase * 12], ["circle-opacity", 0.34 * (1 - phase)]], pulsing);

  useEffect(() => {
    report({ loading: loading && !data, error: error?.message ?? null, count: counters.length });
  }, [report, loading, data, error, counters.length]);
  return null;
}
