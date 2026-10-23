import type { ExpressionSpecification } from "maplibre-gl";
import { useEffect, useMemo, useRef } from "react";
import { useMotionNow, usePoll } from "../../app/core/hooks";
import { profile, useProfile } from "../../app/core/profile";
import { useSettings } from "../../app/core/settings";
import { MAP_INK, useGeoJsonLayer, useMapIcon, type MapLayerProps } from "../city/extension";
import { altitudeLabel, fetchTrack, isFlying, landingRadiusM, projected, ringAround, useSondes } from "./client";
import type { Sonde, SondeSnapshot } from "./types";

/** Balloon silhouette: envelope, string and payload, drawn white so the map can tint it. */
export const BALLOON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><path fill="#fff" d="M24 2.5c-7.4 0-13 5.6-13 12.6 0 6.6 4.8 11.7 11 14.6l-1.4 3.3h6.8L26 29.7c6.2-2.9 11-8 11-14.6 0-7-5.6-12.6-13-12.6z"/><path stroke="#fff" stroke-width="1.6" d="M24 33v6.5"/><rect fill="#fff" x="20.5" y="39.5" width="7" height="5.5" rx="1.2"/></svg>';

const TRAIL_POINTS = 24;
const TICK_MS = 1000;

/** Radiosondes on the City map: balloons with altitude labels, trails, predicted paths, burst points and landing zones. */
export default function SondesLayer({ map, report }: MapLayerProps): null {
  const snapshot = useSondes((s) => s.snapshot);
  const error = useSondes((s) => s.error);
  const units = useSettings((s) => s.units);
  const selected = useProfile((s) => (s.entity?.kind === "sonde" ? s.entity.id : null));
  const iconReady = useMapIcon(map, "vantage-balloon", BALLOON_SVG, { size: 64 });
  const track = usePoll((signal) => fetchTrack(selected ?? "", signal), 60_000, [selected], !selected);

  const shown = useMemo(() => (snapshot ? snapshot.sondes.filter((s) => isFlying(s) || s.phase === "ground") : null), [snapshot]);
  useEffect(() => {
    report({ loading: !snapshot && !error, error: snapshot ? null : (error ?? null), count: shown ? shown.length : null });
  }, [report, snapshot, error, shown]);

  // Where each balloon has been since this page opened, taken from the frames the watcher receives.
  const trails = useRef(new Map<string, [number, number][]>());
  useEffect(() => {
    if (!snapshot) return;
    const live = new Set<string>();
    for (const s of snapshot.sondes) {
      live.add(s.serial);
      const trail = trails.current.get(s.serial) ?? [];
      const last = trail[trail.length - 1];
      if (!last || last[0] !== s.lon || last[1] !== s.lat) trail.push([s.lon, s.lat]);
      trails.current.set(s.serial, trail.slice(-TRAIL_POINTS));
    }
    for (const serial of trails.current.keys()) if (!live.has(serial)) trails.current.delete(serial);
  }, [snapshot]);

  // Balloons drift between reports while someone watches; at rest they move when a new snapshot arrives.
  const now = useMotionNow(shown?.length ? TICK_MS : null);

  const tracked = selected !== null && track.data?.serial === selected ? track.data : null;
  const data = useMemo(() => (snapshot && shown ? build(snapshot, shown, trails.current, tracked, now, selected, units) : null), [snapshot, shown, tracked, now, selected, units]);

  useGeoJsonLayer(map, {
    id: "sondes-zones",
    data: data?.zones ?? null,
    fadeBy: "serial",
    belowLabels: true,
    layers: (source) => [
      { id: `${source}-fill`, type: "fill", source, paint: { "fill-color": ["case", ["get", "selected"], MAP_INK.ice, MAP_INK.sodium], "fill-opacity": ["case", ["get", "selected"], 0.16, 0.08] } },
      { id: `${source}-line`, type: "line", source, paint: { "line-color": ["case", ["get", "selected"], MAP_INK.ice, MAP_INK.sodium], "line-width": 1, "line-opacity": 0.7, "line-dasharray": [2, 2] } },
    ],
  });

  const lineColor: ExpressionSpecification = ["case", ["get", "selected"], MAP_INK.ice, MAP_INK.sodium];
  useGeoJsonLayer(map, {
    id: "sondes-paths",
    data: data?.paths ?? null,
    belowLabels: true,
    layers: (source) => [
      {
        id: `${source}-past`,
        type: "line",
        source,
        filter: ["!=", ["get", "kind"], "predicted"],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": lineColor, "line-width": ["case", ["get", "selected"], 2, 1.2], "line-opacity": ["case", ["get", "selected"], 0.85, 0.32] },
      },
      {
        id: `${source}-predicted`,
        type: "line",
        source,
        filter: ["==", ["get", "kind"], "predicted"],
        layout: { "line-join": "round" },
        paint: { "line-color": lineColor, "line-width": ["case", ["get", "selected"], 1.8, 1.1], "line-opacity": ["case", ["get", "selected"], 0.85, 0.4], "line-dasharray": [2, 2.5] },
      },
    ],
  });

  useGeoJsonLayer(map, {
    id: "sondes-marks",
    data: data?.marks ?? null,
    fadeBy: "id",
    layers: (source) => [
      {
        id: `${source}-dot`,
        type: "circle",
        source,
        paint: {
          "circle-radius": ["case", ["==", ["get", "kind"], "landing"], 4, 5],
          "circle-color": ["case", ["==", ["get", "kind"], "landing"], ["case", ["get", "selected"], MAP_INK.ice, MAP_INK.sodium], MAP_INK.void],
          "circle-stroke-color": ["case", ["get", "selected"], MAP_INK.ice, MAP_INK.sodium],
          "circle-stroke-width": 1.5,
        },
      },
      {
        id: `${source}-label`,
        type: "symbol",
        source,
        minzoom: 7,
        layout: { "text-field": ["get", "label"], "text-font": ["Noto Sans Regular"], "text-size": 10, "text-offset": [0, 1.1], "text-anchor": "top", "text-letter-spacing": 0.08, "text-optional": true },
        paint: { "text-color": ["case", ["get", "selected"], MAP_INK.ice, MAP_INK.fog], "text-halo-color": MAP_INK.void, "text-halo-width": 1.2 },
      },
    ],
  });

  const tint: ExpressionSpecification = ["case", ["get", "selected"], MAP_INK.ice, ["==", ["get", "kind"], "ground"], MAP_INK.fog, MAP_INK.sodium];
  useGeoJsonLayer(map, {
    id: "sondes-balloons",
    data: iconReady ? (data?.balloons ?? null) : null,
    fadeBy: "serial",
    clickable: ["sondes-balloons-icon", "sondes-balloons-ground"],
    onClick: (feature) => {
      const serial = String(feature.properties.serial);
      const s = snapshot?.sondes.find((x) => x.serial === serial);
      if (s && snapshot) profile.open({ kind: "sonde", id: serial, data: { ...s, fetchedAt: snapshot.fetchedAt } });
    },
    layers: (source) => [
      {
        id: `${source}-halo`,
        type: "circle",
        source,
        filter: ["get", "selected"],
        paint: { "circle-radius": 20, "circle-color": MAP_INK.ice, "circle-opacity": 0.12, "circle-stroke-color": MAP_INK.ice, "circle-stroke-width": 1, "circle-stroke-opacity": 0.6 },
      },
      {
        id: `${source}-ground`,
        type: "circle",
        source,
        filter: ["==", ["get", "kind"], "ground"],
        paint: { "circle-radius": 5, "circle-color": MAP_INK.void, "circle-stroke-color": tint, "circle-stroke-width": 1.5 },
      },
      {
        id: `${source}-icon`,
        type: "symbol",
        source,
        filter: ["!=", ["get", "kind"], "ground"],
        layout: {
          "icon-image": "vantage-balloon",
          "icon-size": ["interpolate", ["linear"], ["zoom"], 2, 0.55, 8, 0.8, 14, 1],
          "icon-anchor": "bottom",
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
          "symbol-sort-key": ["get", "alt"],
        },
        paint: { "icon-color": tint },
      },
      {
        id: `${source}-label`,
        type: "symbol",
        source,
        minzoom: 3,
        layout: {
          "text-field": ["get", "label"],
          "text-font": ["Noto Sans Regular"],
          "text-size": 10,
          "text-offset": [0, 0.5],
          "text-anchor": "top",
          "text-letter-spacing": 0.08,
          "text-optional": true,
        },
        paint: { "text-color": ["case", ["get", "selected"], MAP_INK.ice, MAP_INK.fog], "text-halo-color": MAP_INK.void, "text-halo-width": 1.2 },
      },
    ],
  });

  return null;
}

interface LayerData {
  balloons: GeoJSON.FeatureCollection;
  paths: GeoJSON.FeatureCollection;
  zones: GeoJSON.FeatureCollection;
  marks: GeoJSON.FeatureCollection;
}

function build(
  snapshot: SondeSnapshot,
  shown: Sonde[],
  trails: Map<string, [number, number][]>,
  tracked: { points: { lat: number; lon: number }[]; burst: { lat: number; lon: number; altM: number } | null; serial: string } | null,
  now: number,
  selected: string | null,
  units: "metric" | "imperial",
): LayerData {
  const balloons: GeoJSON.Feature[] = [];
  const paths: GeoJSON.Feature[] = [];
  const zones: GeoJSON.Feature[] = [];
  const marks: GeoJSON.Feature[] = [];

  for (const s of shown) {
    const flying = isFlying(s);
    const isSelected = s.serial === selected;
    const p = projected(s, now);
    const head: [number, number] = [p.lon, p.lat];
    balloons.push({
      type: "Feature",
      properties: { serial: s.serial, kind: flying ? "flying" : "ground", label: flying ? altitudeLabel(p.altM, units) : s.serial, alt: p.altM, selected: isSelected },
      geometry: { type: "Point", coordinates: head },
    });
    if (!flying) continue;

    // The selected balloon shows its whole recorded flight; the others show where they have been since this page opened.
    const past = isSelected && tracked ? tracked.points.map((t): [number, number] => [t.lon, t.lat]) : (trails.get(s.serial) ?? []);
    if (past.length > 0) paths.push({ type: "Feature", properties: { kind: "past", selected: isSelected }, geometry: { type: "LineString", coordinates: [...past, head] } });

    const prediction = s.prediction;
    if (!prediction) continue;
    const ahead = prediction.path.filter((q) => q.at > now);
    paths.push({ type: "Feature", properties: { kind: "predicted", selected: isSelected }, geometry: { type: "LineString", coordinates: [head, ...ahead.map((q): [number, number] => [q.lon, q.lat])] } });
    zones.push({ type: "Feature", properties: { serial: s.serial, selected: isSelected }, geometry: { type: "Polygon", coordinates: [ringAround(prediction.landing, landingRadiusM(prediction, now))] } });
    marks.push({ type: "Feature", properties: { id: `${s.serial}:landing`, kind: "landing", label: "Landing", selected: isSelected }, geometry: { type: "Point", coordinates: [prediction.landing.lon, prediction.landing.lat] } });
    if (prediction.burst && prediction.burst.at > now) {
      marks.push({ type: "Feature", properties: { id: `${s.serial}:predicted-burst`, kind: "burst", label: `Burst ${altitudeLabel(prediction.burst.altM, units)}`, selected: isSelected }, geometry: { type: "Point", coordinates: [prediction.burst.lon, prediction.burst.lat] } });
    }
  }

  if (tracked?.burst) {
    marks.push({ type: "Feature", properties: { id: `${tracked.serial}:burst`, kind: "burst", label: `Burst ${altitudeLabel(tracked.burst.altM, units)}`, selected: true }, geometry: { type: "Point", coordinates: [tracked.burst.lon, tracked.burst.lat] } });
  }

  const collect = (features: GeoJSON.Feature[]): GeoJSON.FeatureCollection => ({ type: "FeatureCollection", features });
  return { balloons: collect(balloons), paths: collect(paths), zones: collect(zones), marks: collect(marks) };
}
