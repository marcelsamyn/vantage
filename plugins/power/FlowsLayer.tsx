import { useEffect, useMemo, useRef } from "react";
import { useAmbientMotion, useInterval, usePoll, usePrefersReducedMotion } from "../../app/core/hooks";
import { bearingDeg, distanceM } from "../../shared/geo";
import { MAP_INK, useGeoJsonLayer, useMapIcon, type MapLayerProps } from "../city/extension";
import { ARROW_SVG } from "./arrow";
import { BORDER_CODE, fetchBelgium, fetchLines, powerWords } from "./client";
import type { BelgiumGrid, Border, LineMap } from "./types";

/** Belgium's extent, used to bring it into view the first time the layer opens. */
const BELGIUM: [[number, number], [number, number]] = [
  [1.2, 49.4],
  [6.7, 51.7],
];
const BELGIUM_CENTRE = { lat: 50.6, lon: 4.5 };

/** Dash patterns that, played in order, make a dashed line look as if it moves from its start to its end. */
const MARCH: number[][] = [
  [0, 4, 3],
  [0.5, 4, 2.5],
  [1, 4, 2],
  [1.5, 4, 1.5],
  [2, 4, 1],
  [2.5, 4, 0.5],
  [3, 4, 0],
  [0, 0.5, 3, 3.5],
  [0, 1, 3, 3],
  [0, 1.5, 3, 2.5],
  [0, 2, 3, 2],
  [0, 2.5, 3, 1.5],
  [0, 3, 3, 1],
  [0, 3.5, 3, 0.5],
];
const MARCH_MS = 110;

const mid = (coords: [number, number][]): [number, number] => {
  const a = coords[0] ?? [0, 0];
  const b = coords[coords.length - 1] ?? a;
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
};

interface Drawn {
  internal: GeoJSON.FeatureCollection;
  ties: GeoJSON.FeatureCollection;
  arrows: GeoJSON.FeatureCollection;
  count: number;
}

/** Combine the line geometry (what Elia publishes about its network) with the live flow at each border. */
function draw(lines: LineMap, grid: BelgiumGrid): Drawn {
  const flowOf = (b: Border): number | null => grid.flows.find((f) => f.border === b)?.mw ?? null;
  const internal: GeoJSON.FeatureCollection = {
    type: "FeatureCollection",
    features: lines.internal.map((l) => ({ type: "Feature", properties: { name: l.name }, geometry: { type: "LineString", coordinates: l.coords } })),
  };
  const ties: GeoJSON.FeatureCollection = {
    type: "FeatureCollection",
    features: lines.ties.map((t) => {
      const mw = flowOf(t.border);
      return { type: "Feature", properties: { name: t.name, border: t.border, exporting: (mw ?? 0) > 0, live: mw !== null }, geometry: { type: "LineString", coordinates: t.coords } };
    }),
  };
  // One arrow per border, on the tie line carrying the most load, pointing the way the power flows.
  const arrows: GeoJSON.Feature[] = [];
  for (const border of new Set(lines.ties.map((t) => t.border))) {
    const mw = flowOf(border);
    const lead = lines.ties.filter((t) => t.border === border).sort((a, b) => (b.loading ?? 0) - (a.loading ?? 0))[0];
    if (mw === null || !lead) continue;
    const [lon, lat] = mid(lead.coords);
    const first = lead.coords[0];
    const last = lead.coords[lead.coords.length - 1];
    if (!first || !last) continue;
    const outward = bearingDeg({ lat: first[1], lon: first[0] }, { lat: last[1], lon: last[0] });
    arrows.push({
      type: "Feature",
      properties: { border, bearing: mw >= 0 ? outward : (outward + 180) % 360, scale: 0.5 + Math.min(0.6, Math.abs(mw) / 5000), label: `${BORDER_CODE[border]} ${powerWords(mw)}` },
      geometry: { type: "Point", coordinates: [lon, lat] },
    });
  }
  return { internal, ties, arrows: { type: "FeatureCollection", features: arrows }, count: arrows.length };
}

/**
 * Electricity crossing Belgium's borders. Line shapes come from Elia's 380 kV network data, the flows
 * from its per-border readings; arrows sit on the real tie lines and point the way the power goes.
 */
export default function FlowsLayer({ map, report, claimFraming }: MapLayerProps): null {
  const lines = usePoll((signal) => fetchLines(signal), null, []);
  const grid = usePoll((signal) => fetchBelgium(signal), 90_000, []);
  const icon = useMapIcon(map, "power-arrow", ARROW_SVG, { size: 64 });
  const ambient = useAmbientMotion();
  const reduced = usePrefersReducedMotion();
  const drawn = useMemo(() => (lines.data && grid.data ? draw(lines.data, grid.data) : null), [lines.data, grid.data]);

  useEffect(() => {
    const error = lines.error ?? grid.error;
    report({ loading: !drawn && !error, error: drawn ? null : (error?.message ?? null), count: drawn?.count ?? null });
  }, [report, drawn, lines.error, grid.error]);

  // Switched on far from Belgium, the layer brings Belgium into view: that is the only place it has data.
  useEffect(() => {
    if (!drawn || !claimFraming()) return;
    const c = map.getCenter();
    if (distanceM({ lat: c.lat, lon: c.lng }, BELGIUM_CENTRE) > 400_000) map.fitBounds(BELGIUM, { padding: 80, duration: reduced ? 0 : 1400, maxZoom: 7.5 });
  }, [map, drawn, reduced, claimFraming]);

  useGeoJsonLayer(map, {
    id: "power-grid",
    data: drawn?.internal ?? null,
    belowLabels: true,
    layers: (source) => [{ id: `${source}-line`, type: "line", source, paint: { "line-color": MAP_INK.bone, "line-opacity": 0.45, "line-width": ["interpolate", ["linear"], ["zoom"], 5, 1.2, 9, 2.2] } }],
  });

  useGeoJsonLayer(map, {
    id: "power-ties",
    data: drawn?.ties ?? null,
    layers: (source) => [
      { id: `${source}-glow`, type: "line", source, paint: { "line-color": MAP_INK.sodium, "line-opacity": 0.22, "line-width": ["interpolate", ["linear"], ["zoom"], 5, 4, 9, 9], "line-blur": 3 } },
      { id: `${source}-line`, type: "line", source, paint: { "line-color": MAP_INK.sodium, "line-opacity": 0.85, "line-width": ["interpolate", ["linear"], ["zoom"], 5, 1.4, 9, 2.4] } },
      { id: `${source}-out`, type: "line", source, filter: ["==", ["get", "exporting"], true], paint: { "line-color": MAP_INK.bone, "line-width": ["interpolate", ["linear"], ["zoom"], 5, 1, 9, 1.8], "line-dasharray": MARCH[0] ?? [1, 1] } },
      { id: `${source}-in`, type: "line", source, filter: ["==", ["get", "exporting"], false], paint: { "line-color": MAP_INK.bone, "line-width": ["interpolate", ["linear"], ["zoom"], 5, 1, 9, 1.8], "line-dasharray": MARCH[0] ?? [1, 1] } },
    ],
  });

  useGeoJsonLayer(map, {
    id: "power-arrows",
    data: icon ? (drawn?.arrows ?? null) : null,
    fadeBy: "border",
    layers: (source) => [
      {
        id: `${source}-arrow`,
        type: "symbol",
        source,
        layout: { "icon-image": "power-arrow", "icon-size": ["get", "scale"], "icon-rotate": ["get", "bearing"], "icon-rotation-alignment": "map", "icon-allow-overlap": true, "icon-ignore-placement": true },
        paint: { "icon-color": MAP_INK.sodium, "icon-halo-color": MAP_INK.void, "icon-halo-width": 1 },
      },
      {
        id: `${source}-label`,
        type: "symbol",
        source,
        layout: { "text-field": ["get", "label"], "text-font": ["Noto Sans Regular"], "text-size": 11, "text-offset": [0, 1.6], "text-anchor": "top", "text-allow-overlap": true },
        paint: { "text-color": MAP_INK.bone, "text-halo-color": MAP_INK.void, "text-halo-width": 1.5 },
      },
    ],
  });

  // Marching dashes along the tie lines: toward the foreign end for exports, toward Belgium for imports.
  // An ambient loop: it rests with the motion policy, so the map idles when nobody watches.
  const step = useRef(0);
  useInterval(
    () => {
      step.current = (step.current + 1) % MARCH.length;
      if (!map.style) return;
      if (map.getLayer("power-ties-out")) map.setPaintProperty("power-ties-out", "line-dasharray", MARCH[step.current] ?? [1, 1]);
      if (map.getLayer("power-ties-in")) map.setPaintProperty("power-ties-in", "line-dasharray", MARCH[(MARCH.length - step.current) % MARCH.length] ?? [1, 1]);
    },
    drawn && ambient ? MARCH_MS : null,
  );

  return null;
}
