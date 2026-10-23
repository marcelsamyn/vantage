import { Satellite } from "lucide-react";
import { useEffect, useMemo } from "react";
import { useMotionNow } from "../../app/core/hooks";
import { profile, useProfile } from "../../app/core/profile";
import { destination } from "../../shared/geo";
import { MAP_INK, ringIcon, useGeoJsonLayer, useMapIcon, type MapLayerProps } from "../city/extension";
import { CREWED, displayName, stateAt, useSats, type Sat } from "./client";

const EARTH_KM = 6371;

/** Crewed space stations on the City map: where they are, the ground they will cross, and who can see them. */
export default function StationsLayer({ map, report }: MapLayerProps): null {
  const { sats, error, loading } = useSats("stations");
  const crewed = useMemo(() => sats.filter((s) => CREWED(s.ref.name)), [sats]);
  const selected = useProfile((s) => (s.entity?.kind === "satellite" ? s.entity.id : null));
  const icon = useMapIcon(map, "satellites-station", Satellite);
  // Every second while someone watches; at rest every 30 s, which keeps a station within a few hundred km.
  const now = useMotionNow(crewed.length ? 1000 : null, crewed.length ? 30_000 : null);

  useEffect(() => report({ loading: loading && crewed.length === 0, error: error?.message ?? null, count: crewed.length || null }), [report, crewed.length, error, loading]);

  // Ground tracks change slowly; recompute them every 30 s.
  const trackBucket = Math.floor(now / 30_000);
  const tracks = useMemo(() => featureCollection(crewed.flatMap((s) => groundTrack(s, trackBucket * 30_000))), [crewed, trackBucket]);
  const live = useMemo(() => featureCollection(crewed.flatMap((s) => stationFeatures(s, now, selected))), [crewed, now, selected]);

  useGeoJsonLayer(map, {
    id: "satellites-tracks",
    data: tracks,
    belowLabels: true,
    layers: (source) => [
      {
        id: `${source}-line`,
        type: "line",
        source,
        paint: { "line-color": MAP_INK.ice, "line-width": 1.2, "line-opacity": ["case", ["get", "future"], 0.45, 0.18], "line-dasharray": [2, 2] },
      },
    ],
  });

  useGeoJsonLayer(map, {
    id: "satellites-stations",
    data: icon ? live : null,
    clickable: ["satellites-stations-point"],
    onClick: (f) => {
      const s = crewed.find((c) => String(c.ref.norad) === String(f.properties.norad));
      if (s) profile.open({ kind: "satellite", id: String(s.ref.norad), data: s.ref });
    },
    layers: (source) => [
      { id: `${source}-footprint`, type: "fill", source, filter: ["==", ["get", "kind"], "footprint"], paint: { "fill-color": MAP_INK.ice, "fill-opacity": 0.04 } },
      { id: `${source}-footprint-edge`, type: "line", source, filter: ["==", ["get", "kind"], "footprint"], paint: { "line-color": MAP_INK.ice, "line-opacity": 0.3, "line-width": 1 } },
      {
        id: `${source}-point`,
        type: "circle",
        source,
        filter: ["==", ["get", "kind"], "station"],
        paint: {
          "circle-radius": ["case", ["get", "selected"], 11, 9.5],
          "circle-color": MAP_INK.void,
          "circle-stroke-color": MAP_INK.ice,
          "circle-stroke-width": 2,
        },
      },
      ringIcon(source, { icon: "satellites-station", color: MAP_INK.ice, px: 13, filter: ["==", ["get", "kind"], "station"] }),
      {
        id: `${source}-label`,
        type: "symbol",
        source,
        filter: ["==", ["get", "kind"], "station"],
        layout: { "text-field": ["get", "label"], "text-font": ["Noto Sans Regular"], "text-size": 11, "text-offset": [0, 1.6], "text-anchor": "top", "text-letter-spacing": 0.1 },
        paint: { "text-color": MAP_INK.ice, "text-halo-color": MAP_INK.void, "text-halo-width": 1.4 },
      },
    ],
  });

  return null;
}

const featureCollection = (features: GeoJSON.Feature[]): GeoJSON.FeatureCollection => ({ type: "FeatureCollection", features });

/** The ground track 45 minutes back and 90 minutes ahead, split where it crosses the antimeridian. */
function groundTrack(s: Sat, now: number): GeoJSON.Feature[] {
  const features: GeoJSON.Feature[] = [];
  for (const [future, from, to] of [
    [false, -45, 0],
    [true, 0, 90],
  ] as const) {
    let line: [number, number][] = [];
    let prevLon: number | null = null;
    for (let m = from; m <= to; m += 0.5) {
      const st = stateAt(s.rec, new Date(now + m * 60_000));
      if (!st) continue;
      if (prevLon !== null && Math.abs(st.lon - prevLon) > 180) {
        if (line.length > 1) features.push({ type: "Feature", properties: { future }, geometry: { type: "LineString", coordinates: line } });
        line = [];
      }
      line.push([st.lon, st.lat]);
      prevLon = st.lon;
    }
    if (line.length > 1) features.push({ type: "Feature", properties: { future }, geometry: { type: "LineString", coordinates: line } });
  }
  return features;
}

/** The station itself, plus the circle of ground from which it is above the horizon. */
function stationFeatures(s: Sat, now: number, selected: string | null): GeoJSON.Feature[] {
  const st = stateAt(s.rec, new Date(now));
  if (!st) return [];
  const radiusKm = EARTH_KM * Math.acos(EARTH_KM / (EARTH_KM + st.altKm));
  const ring = Array.from({ length: 73 }, (_, i) => {
    const p = destination(st, i * 5, radiusKm * 1000);
    return [p.lon, p.lat];
  });
  const crossesDateline = ring.some((p, i) => i > 0 && Math.abs((p[0] ?? 0) - (ring[i - 1]?.[0] ?? 0)) > 180);
  const features: GeoJSON.Feature[] = [
    { type: "Feature", properties: { kind: "station", norad: s.ref.norad, label: displayName(s.ref.name).toUpperCase(), selected: String(s.ref.norad) === selected }, geometry: { type: "Point", coordinates: [st.lon, st.lat] } },
  ];
  if (!crossesDateline) features.push({ type: "Feature", properties: { kind: "footprint" }, geometry: { type: "Polygon", coordinates: [ring] } });
  return features;
}
