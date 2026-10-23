import type { ExpressionSpecification } from "maplibre-gl";
import { useEffect, useMemo, useRef } from "react";
import { usePoll } from "../../app/core/hooks";
import { profile, useProfile } from "../../app/core/profile";
import { MAP_INK, useGeoJsonLayer, useMapIcon, useMapView, type MapLayerProps } from "../city/extension";
import { fetchShips } from "./client";
import { shipSourceProblem } from "./vessel";

/** Hull seen from above, bow up, drawn white so the map can tint it by vessel type. */
const SHIP_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><path fill="#fff" d="M24 2c5 7 8 15 8 23v19c0 1-1 2-2 2H18c-1 0-2-1-2-2V25c0-8 3-16 8-23z"/></svg>';

const SAR_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><path fill="#fff" d="M22 3h4l3 15 16 12v5L28 29l-1 12 6 4v2l-9-2-9 2v-2l6-4-1-12-17 6v-5l16-12z"/></svg>';

const TRAIL_POINTS = 14;
/** A vessel slower than this is shown as a dot: its heading is noise. */
const MOVING_KT = 0.5;

const TYPE_COLOR: ExpressionSpecification = ["match", ["get", "category"], "passenger", MAP_INK.mint, "cargo", MAP_INK.sodium, "tanker", MAP_INK.bone, "fishing", MAP_INK.fog, MAP_INK.ash];

/** Vessels in view, turned to their heading, coloured by type, with a short trail of where they have been. */
export default function ShipLayer({ map, report }: MapLayerProps): null {
  const view = useMapView(map);
  const iconReady = useMapIcon(map, "vantage-ship", SHIP_SVG, { size: 48 });
  const sarIconReady = useMapIcon(map, "vantage-ship-sar", SAR_SVG, { size: 48 });
  const selected = useProfile((s) => (s.entity?.kind === "ship" ? Number(s.entity.id) : null));

  // Ask for the visible area with a margin, rounded so a small pan reuses the same request.
  const pad = 1;
  const snap = (v: number): number => Math.round(v / pad) * pad;
  const box = { west: snap(view.west) - pad, south: Math.max(-90, snap(view.south) - pad), east: snap(view.east) + pad, north: Math.min(90, snap(view.north) + pad) };
  const key = `${box.west},${box.south},${box.east},${box.north}`;
  const { data, error, loading } = usePoll((signal) => fetchShips(box, signal), 15_000, [key]);

  const trails = useRef(new Map<number, [number, number][]>());
  useEffect(() => {
    if (!data) return;
    const live = new Set<number>();
    for (const v of data.vessels) {
      live.add(v.mmsi);
      const trail = trails.current.get(v.mmsi) ?? [];
      const last = trail[trail.length - 1];
      if (!last || last[0] !== v.lon || last[1] !== v.lat) trail.push([v.lon, v.lat]);
      trails.current.set(v.mmsi, trail.slice(-TRAIL_POINTS));
    }
    for (const mmsi of trails.current.keys()) if (!live.has(mmsi)) trails.current.delete(mmsi);
  }, [data]);

  const problem = shipSourceProblem(data);
  useEffect(() => report({ loading: loading && !data, error: error?.message ?? problem, count: data?.vessels.length ?? null }), [report, data, error, loading, problem]);

  const points = useMemo(
    (): GeoJSON.FeatureCollection | null =>
      data
        ? {
            type: "FeatureCollection",
            features: data.vessels.map((v) => ({
              type: "Feature",
              properties: {
                mmsi: v.mmsi,
                category: v.category,
                sar: v.reportKind === "sar-aircraft",
                course: v.headingDeg ?? v.cogDeg ?? 0,
                moving: v.reportKind === "sar-aircraft" || (v.sogKt ?? 0) >= MOVING_KT,
                selected: v.mmsi === selected,
                label: v.name ?? "",
              },
              geometry: { type: "Point", coordinates: [v.lon, v.lat] },
            })),
          }
        : null,
    [data, selected],
  );

  const lines = useMemo((): GeoJSON.FeatureCollection | null => {
    if (!data) return null;
    const features: GeoJSON.Feature[] = [];
    for (const v of data.vessels) {
      const trail = trails.current.get(v.mmsi);
      if (trail && trail.length > 1) features.push({ type: "Feature", properties: { mmsi: v.mmsi, selected: v.mmsi === selected }, geometry: { type: "LineString", coordinates: trail } });
    }
    return { type: "FeatureCollection", features };
  }, [data, selected]);

  useGeoJsonLayer(map, {
    id: "ships-trails",
    data: lines,
    fadeBy: "mmsi",
    belowLabels: true,
    layers: (source) => [
      {
        id: `${source}-line`,
        type: "line",
        source,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": ["case", ["get", "selected"], MAP_INK.ice, MAP_INK.fog], "line-width": ["case", ["get", "selected"], 2, 1], "line-opacity": ["case", ["get", "selected"], 0.85, 0.35] },
      },
    ],
  });

  useGeoJsonLayer(map, {
    id: "ships-vessels",
    data: iconReady && sarIconReady ? points : null,
    fadeBy: "mmsi",
    clickable: ["ships-vessels-icon", "ships-vessels-dot"],
    onClick: (f) => {
      const v = data?.vessels.find((x) => x.mmsi === f.properties.mmsi);
      if (v) profile.open({ kind: "ship", id: String(v.mmsi), data: v });
    },
    layers: (source) => [
      {
        id: `${source}-halo`,
        type: "circle",
        source,
        filter: ["get", "selected"],
        paint: { "circle-radius": 16, "circle-color": MAP_INK.ice, "circle-opacity": 0.14, "circle-stroke-color": MAP_INK.ice, "circle-stroke-width": 1, "circle-stroke-opacity": 0.7 },
      },
      {
        id: `${source}-dot`,
        type: "circle",
        source,
        filter: ["!", ["get", "moving"]],
        paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, 2.4, 12, 5], "circle-color": ["case", ["get", "selected"], MAP_INK.ice, TYPE_COLOR], "circle-opacity": 0.75 },
      },
      {
        id: `${source}-icon`,
        type: "symbol",
        source,
        filter: ["get", "moving"],
        layout: {
          "icon-image": ["case", ["get", "sar"], "vantage-ship-sar", "vantage-ship"],
          "icon-size": ["interpolate", ["linear"], ["zoom"], 4, 0.26, 9, 0.42, 14, 0.7],
          "icon-rotate": ["get", "course"],
          "icon-rotation-alignment": "map",
          "icon-pitch-alignment": "map",
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
        },
        paint: { "icon-color": ["case", ["get", "selected"], MAP_INK.ice, TYPE_COLOR] },
      },
      {
        id: `${source}-label`,
        type: "symbol",
        source,
        minzoom: 9,
        layout: { "text-field": ["get", "label"], "text-font": ["Noto Sans Regular"], "text-size": 10, "text-offset": [0, 1.4], "text-anchor": "top", "text-optional": true, "text-letter-spacing": 0.05 },
        paint: { "text-color": ["case", ["get", "selected"], MAP_INK.ice, MAP_INK.fog], "text-halo-color": MAP_INK.void, "text-halo-width": 1.2 },
      },
    ],
  });

  return null;
}
