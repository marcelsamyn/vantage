import { useEffect, useMemo } from "react";
import { profile, useProfile } from "../../app/core/profile";
import { MAP_INK, useGeoJsonLayer, useMapPulse, type MapLayerProps } from "../city/extension";
import { useCircling } from "./client";

type Coord = [number, number];

/** Round the corners of a flown path: each segment is replaced by points a quarter in from both ends. */
function smooth(path: Coord[], passes = 2): Coord[] {
  let line = path;
  for (let i = 0; i < passes && line.length > 2; i++) {
    const next: Coord[] = [line[0] as Coord];
    for (let j = 0; j < line.length - 1; j++) {
      const a = line[j] as Coord;
      const b = line[j + 1] as Coord;
      next.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    next.push(line[line.length - 1] as Coord);
    line = next;
  }
  return line;
}

/** The path of every aircraft circling near you, drawn as a glowing loop that breathes. */
export default function CirclingLayer({ map, report }: MapLayerProps): null {
  const byHex = useCircling((s) => s.byHex);
  const selected = useProfile((s) => (s.entity?.kind === "aircraft" ? s.entity.id : null));

  useEffect(() => {
    report({ loading: false, error: null, count: byHex.size });
  }, [report, byHex]);

  const data = useMemo(() => {
    const loops: GeoJSON.Feature[] = [];
    const heads: GeoJSON.Feature[] = [];
    for (const { aircraft: a, loiter } of byHex.values()) {
      const path: Coord[] = loiter.path.map((f) => [f.lon, f.lat]);
      const head = path[path.length - 1];
      if (!head) continue;
      const isSelected = a.hex === selected;
      loops.push({ type: "Feature", properties: { hex: a.hex, selected: isSelected }, geometry: { type: "LineString", coordinates: smooth(path) } });
      heads.push({ type: "Feature", properties: { id: `${a.hex}:head`, hex: a.hex, selected: isSelected, kind: "head" }, geometry: { type: "Point", coordinates: head } });
      // The caption sits in the middle of the loop, clear of the path.
      heads.push({
        type: "Feature",
        properties: { id: `${a.hex}:caption`, hex: a.hex, selected: isSelected, kind: "caption", label: `Circling · ${loiter.minutes} min` },
        geometry: { type: "Point", coordinates: [loiter.center.lon, loiter.center.lat] },
      });
    }
    const collect = (features: GeoJSON.Feature[]): GeoJSON.FeatureCollection => ({ type: "FeatureCollection", features });
    return { loops: collect(loops), heads: collect(heads) };
  }, [byHex, selected]);

  useMapPulse(
    map,
    "aircraft-loops-glow",
    3200,
    (phase) => {
      const breath = 0.5 + 0.5 * Math.sin(phase * 2 * Math.PI);
      return [
        ["line-opacity", 0.28 + 0.3 * breath],
        ["line-width", 8 + 5 * breath],
      ];
    },
    byHex.size > 0,
  );

  useGeoJsonLayer(map, {
    id: "aircraft-loops",
    data: data.loops,
    fadeBy: "hex",
    layers: (source) => [
      {
        id: `${source}-glow`,
        type: "line",
        source,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": ["case", ["get", "selected"], MAP_INK.ice, MAP_INK.sodium], "line-width": 10, "line-blur": 7, "line-opacity": 0.4 },
      },
      {
        id: `${source}-core`,
        type: "line",
        source,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": ["case", ["get", "selected"], MAP_INK.ice, MAP_INK.sodium], "line-width": 1.8, "line-opacity": 0.95 },
      },
    ],
  });

  useGeoJsonLayer(map, {
    id: "aircraft-loop-heads",
    data: data.heads,
    fadeBy: "id",
    clickable: ["aircraft-loop-heads-dot"],
    onClick: (feature) => {
      const circling = useCircling.getState().byHex.get(String(feature.properties.hex));
      if (circling) profile.open({ kind: "aircraft", id: circling.aircraft.hex, data: { ...circling.aircraft, fetchedAt: circling.fetchedAt } });
    },
    layers: (source) => [
      {
        id: `${source}-dot`,
        type: "circle",
        source,
        filter: ["==", ["get", "kind"], "head"],
        paint: { "circle-radius": 5, "circle-color": MAP_INK.void, "circle-stroke-color": ["case", ["get", "selected"], MAP_INK.ice, MAP_INK.sodium], "circle-stroke-width": 2 },
      },
      {
        id: `${source}-label`,
        type: "symbol",
        source,
        filter: ["==", ["get", "kind"], "caption"],
        layout: { "text-field": ["get", "label"], "text-font": ["Noto Sans Regular"], "text-size": 11, "text-anchor": "center", "text-letter-spacing": 0.06, "text-optional": true },
        paint: { "text-color": ["case", ["get", "selected"], MAP_INK.ice, MAP_INK.sodium], "text-halo-color": MAP_INK.void, "text-halo-width": 1.4 },
      },
    ],
  });

  return null;
}
