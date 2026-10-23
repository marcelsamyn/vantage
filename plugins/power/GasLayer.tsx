import { useEffect, useMemo } from "react";
import { usePoll, usePrefersReducedMotion } from "../../app/core/hooks";
import { profile, useProfile } from "../../app/core/profile";
import { distanceM } from "../../shared/geo";
import { MAP_INK, useGeoJsonLayer, useMapIcon, useMapPulse, type MapLayerProps } from "../city/extension";
import { ARROW_SVG } from "./arrow";
import { fetchGas, gasWords } from "./client";
import type { GasFlows } from "./types";

/** The biggest single flow the screen has seen, in GWh/h. Arrows are sized against it so a quiet day looks quiet. */
const FULL_ARROW_GWH = 26;

function draw(flows: GasFlows, selected: string | null): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: flows.sites.map((s) => {
      const flowing = Math.abs(s.gwh) >= 0.005;
      const inward = s.gwh >= 0;
      return {
        type: "Feature",
        properties: {
          id: s.id,
          flowing,
          inward,
          selected: s.id === selected,
          // Arrows point the way the gas goes: into the country, or back out when the flow reverses.
          bearing: inward ? s.bearing : (s.bearing + 180) % 360,
          scale: 0.6 + 1.1 * Math.sqrt(Math.min(1, Math.abs(s.gwh) / FULL_ARROW_GWH)),
          ring: 15 + 18 * Math.sqrt(Math.min(1, Math.abs(s.gwh) / FULL_ARROW_GWH)),
          label: flowing ? `${s.name} · ${inward ? "" : "−"}${gasWords(s.gwh)}` : `${s.name} · no flow`,
        },
        geometry: { type: "Point", coordinates: [s.lon, s.lat] },
      };
    }),
  };
}

/**
 * Gas entering Italy and Belgium. One arrow per terminal or border pipeline, pointing the way the gas goes and
 * sized by its flow in GWh/h; a ring breathes around the ones that are flowing. Sites with no flow show a bare ring.
 */
export default function GasLayer({ map, report, claimFraming }: MapLayerProps): null {
  const { data, error } = usePoll((signal) => fetchGas(signal), 10 * 60_000, []);
  const icon = useMapIcon(map, "power-arrow", ARROW_SVG, { size: 64 });
  const reduced = usePrefersReducedMotion();
  const selected = useProfile((s) => (s.entity?.kind === "gaspoint" ? s.entity.id : null));
  const drawn = useMemo(() => (data ? draw(data, selected) : null), [data, selected]);

  useEffect(() => {
    report({ loading: !data && !error, error: data ? null : (error?.message ?? null), count: data ? data.sites.filter((s) => Math.abs(s.gwh) >= 0.005).length : null });
  }, [report, data, error]);

  // Terminals are hundreds of kilometres apart: opened from a street-level view, the layer shows nothing. The first time
  // it has data after the viewer switches it on, it frames the sites of whichever country is nearer.
  useEffect(() => {
    if (!data || !claimFraming()) return;
    if (map.getZoom() < 7) return;
    const c = map.getCenter();
    const groups = (["IT", "BE"] as const).map((country) => data.sites.filter((s) => s.country === country));
    const centre = (sites: typeof data.sites): { lat: number; lon: number } => ({ lat: sites.reduce((a, s) => a + s.lat, 0) / sites.length, lon: sites.reduce((a, s) => a + s.lon, 0) / sites.length });
    const nearest = groups.filter((g) => g.length > 0).sort((a, b) => distanceM({ lat: c.lat, lon: c.lng }, centre(a)) - distanceM({ lat: c.lat, lon: c.lng }, centre(b)))[0];
    if (!nearest) return;
    const lons = nearest.map((s) => s.lon);
    const lats = nearest.map((s) => s.lat);
    map.fitBounds(
      [
        [Math.min(...lons), Math.min(...lats)],
        [Math.max(...lons), Math.max(...lats)],
      ],
      { padding: 120, duration: reduced ? 0 : 1600, maxZoom: 6.2, pitch: 0 },
    );
  }, [map, data, reduced, claimFraming]);

  useGeoJsonLayer(map, {
    id: "power-gas",
    data: icon ? drawn : null,
    fadeBy: "id",
    clickable: ["power-gas-arrow", "power-gas-idle"],
    onClick: (f) => {
      const site = data?.sites.find((s) => s.id === f.properties.id);
      if (site) profile.open({ kind: "gaspoint", id: site.id, data: site });
    },
    layers: (source) => [
      {
        id: `${source}-halo`,
        type: "circle",
        source,
        filter: ["get", "flowing"],
        paint: { "circle-radius": ["get", "ring"], "circle-color": MAP_INK.sodium, "circle-opacity": 0.14, "circle-stroke-color": MAP_INK.sodium, "circle-stroke-width": 1, "circle-stroke-opacity": 0.5 },
      },
      {
        id: `${source}-idle`,
        type: "circle",
        source,
        filter: ["!", ["get", "flowing"]],
        paint: { "circle-radius": 6, "circle-color": MAP_INK.void, "circle-stroke-color": MAP_INK.ash, "circle-stroke-width": 1.5 },
      },
      {
        id: `${source}-arrow`,
        type: "symbol",
        source,
        filter: ["get", "flowing"],
        layout: { "icon-image": "power-arrow", "icon-size": ["get", "scale"], "icon-rotate": ["get", "bearing"], "icon-rotation-alignment": "map", "icon-allow-overlap": true, "icon-ignore-placement": true },
        paint: { "icon-color": ["case", ["get", "selected"], MAP_INK.ice, ["get", "inward"], MAP_INK.sodium, MAP_INK.fog], "icon-halo-color": MAP_INK.void, "icon-halo-width": 1 },
      },
      {
        id: `${source}-label`,
        type: "symbol",
        source,
        minzoom: 4.5,
        layout: { "text-field": ["get", "label"], "text-font": ["Noto Sans Regular"], "text-size": 11, "text-offset": [0, 2.6], "text-anchor": "top", "text-allow-overlap": true, "text-max-width": 12 },
        paint: { "text-color": ["case", ["get", "selected"], MAP_INK.ice, MAP_INK.bone], "text-halo-color": MAP_INK.void, "text-halo-width": 1.5 },
      },
    ],
  });

  // The rings breathe: gas is always moving, even when the numbers hold still.
  useMapPulse(
    map,
    "power-gas-halo",
    2200,
    (cycle) => {
      const phase = (Math.sin(cycle * Math.PI * 2) + 1) / 2;
      return [
        ["circle-radius", ["*", ["get", "ring"], 0.82 + 0.3 * phase]],
        ["circle-opacity", 0.07 + 0.14 * (1 - phase)],
      ];
    },
    drawn !== null,
  );

  return null;
}
