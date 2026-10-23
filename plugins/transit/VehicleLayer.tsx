import { VehicleDisplay } from "./display";
import { pointOnPath } from "./geometry";
import { BusFront, Navigation, Ship, TrainFront, TrainFrontTunnel, TramFront } from "lucide-react";
import type { ExpressionSpecification, Map as MapLibreMap } from "maplibre-gl";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAnimationFrame, usePoll } from "../../app/core/hooks";
import { profile, useProfile } from "../../app/core/profile";
import { MAP_INK, ringIcon, useGeoJsonLayer, useMapIcon, useMapView, type MapLayerProps } from "../city/extension";
import { OCCUPANCY_LEVEL, fetchTrips, modeGroup, positionAt, transitNow, useTransitNow, vehicleKey } from "./client";
import type { TripSegment } from "./types";


export const MODE_COLOR: ExpressionSpecification = ["match", ["get", "group"], "rail", MAP_INK.sodium, "metro", MAP_INK.ice, "tram", MAP_INK.mint, "bus", MAP_INK.bone, "ferry", MAP_INK.ice, MAP_INK.fog];

/** From this zoom each vehicle grows into a disc that holds an icon for its kind. */
const ICON_ZOOM = 14;

type Pip = { name: string; level: number; color: string };
/** One small four-pip bar per seat-occupancy state, drawn beside the vehicle dot. */
const PIPS: Pip[] = [
  { name: "transit-occ-0", level: 0, color: MAP_INK.mint },
  { name: "transit-occ-1", level: 1, color: MAP_INK.mint },
  { name: "transit-occ-2", level: 2, color: MAP_INK.sodium },
  { name: "transit-occ-3", level: 3, color: MAP_INK.sodium },
  { name: "transit-occ-4", level: 4, color: MAP_INK.alarm },
];

function pipSvg({ level, color }: Pip): string {
  const rects = [0, 1, 2, 3]
    .map((i) => {
      const x = 1 + i * 5.5;
      return i < level ? `<rect x="${x}" y="0.5" width="4.5" height="7" fill="${color}"/>` : `<rect x="${x + 0.5}" y="1" width="3.5" height="6" fill="none" stroke="${color}" stroke-width="1"/>`;
    })
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="16" viewBox="0 0 24 8">${rects}</svg>`;
}

const PIP_NAME_BY_STATE = Object.fromEntries((Object.keys(OCCUPANCY_LEVEL) as (keyof typeof OCCUPANCY_LEVEL)[]).map((k) => [k, `transit-occ-${OCCUPANCY_LEVEL[k].level}`]));

/** Every bus, tram, metro and train in view, moving along its route between stops in real time. */
export default function VehicleLayer({ map, report }: MapLayerProps): null {
  const view = useMapView(map);
  const key = `${view.west.toFixed(2)},${view.south.toFixed(2)},${view.east.toFixed(2)},${view.north.toFixed(2)},${Math.round(view.zoom)}`;
  const { data: response, error, loading } = usePoll((signal) => fetchTrips(view, view.zoom, signal), 10_000, [key]);
  const data = response?.vehicles;
  const selected = useProfile((s) => (s.entity?.kind === "vehicle" ? s.entity.id : null));
  // Vehicles move along their routes while someone watches; at rest they move when a new list arrives.
  const now = useTransitNow();
  const display = useRef(new VehicleDisplay());

  const pipsReady = usePipIcons(map);
  const modesReady = [
    useMapIcon(map, "transit-rail", TrainFront),
    useMapIcon(map, "transit-metro", TrainFrontTunnel),
    useMapIcon(map, "transit-tram", TramFront),
    useMapIcon(map, "transit-bus", BusFront),
    useMapIcon(map, "transit-ferry", Ship),
    useMapIcon(map, "transit-other", Navigation),
  ].every(Boolean);

  const drawVehicles = (time: number): GeoJSON.FeatureCollection | null => {
    if (!data) return null;
    const features: GeoJSON.Feature[] = [];
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    for (const s of data) {
      const p = positionAt(s, time);
      if (!p) continue;
      const draw = display.current.position(s, time, performance.now(), reduced);
      if (!draw) continue;
      const at = [draw.at.lon, draw.at.lat];
      const delay = s.delayMin ?? 0;
      features.push({
        type: "Feature",
        properties: {
          trip: vehicleKey(s),
          route: s.route,
          group: modeGroup(s.mode),
          delay: delay >= 5 ? "alarm" : delay >= 1 ? "sodium" : "none",
          selected: vehicleKey(s) === selected,
          gps: s.fix !== null,
          opacity: draw.opacity * (p.quality === "last-known" || p.quality === "scheduled" ? 0.45 : 1),
          estimated: p.estimated,
          occ: s.occupancy ? (PIP_NAME_BY_STATE[s.occupancy] ?? "") : "",
        },
        geometry: { type: "Point", coordinates: at },
      });
    }
    return { type: "FeatureCollection", features };
  };
  const vehicles = useMemo(() => drawVehicles(now), [data, now, selected]);
  // While vehicles are shown they glide in ten steps a second. Each step reaches the map through `useGeoJsonLayer`,
  // the source's only writer, which also holds steps back while the camera moves.
  const gliding = !!data?.length && pipsReady && modesReady;
  const [step, setStep] = useState<GeoJSON.FeatureCollection | null>(null);
  useAnimationFrame(() => setStep(drawVehicles(transitNow())), gliding, "data", 10);
  // A glide that starts again begins from fresh positions, not from where the last one stopped.
  useEffect(() => {
    if (!gliding) setStep(null);
  }, [gliding]);

  useEffect(() => report({ loading: loading && !data, error: error?.message ?? response?.notice ?? null, count: vehicles?.features.length ?? null }), [report, data, error, response?.notice, loading, vehicles?.features.length]);

  const path = useMemo((): GeoJSON.FeatureCollection | null => {
    const s = selected ? data?.find((x) => vehicleKey(x) === selected) : undefined;
    const lines = (s?.legs ?? (s ? [s] : [])).map(l => l.line).filter(l => l.length > 1);
    const features: GeoJSON.Feature[] = lines.length ? [{ type: "Feature", properties: { uncertainty: false }, geometry: { type: "MultiLineString", coordinates: lines } }] : [];
    const tracking = s?.tracking;
    const estimate = s ? positionAt(s, now) : null;
    if (tracking?.path && estimate) for (const range of estimate.ranges) {
      const section = tracking.path.sections[range.section];
      if (!section) continue;
      const lo = Math.max(range.from, tracking.path.meters[section.start] ?? 0);
      const hi = Math.min(range.to, tracking.path.meters[section.end] ?? 0);
      const first = pointOnPath(tracking.path, lo, range.section), last = pointOnPath(tracking.path, hi, range.section);
      if (!first || !last || hi <= lo) continue;
      const between = tracking.path.points.filter((_, i) => i >= section.start && i <= section.end && (tracking.path?.meters[i] ?? 0) > lo && (tracking.path?.meters[i] ?? 0) < hi);
      features.push({ type: "Feature", properties: { uncertainty: true }, geometry: { type: "LineString", coordinates: [[first.lon, first.lat], ...between, [last.lon, last.lat]] } });
    }
    return features.length ? { type: "FeatureCollection", features } : null;
  }, [data, selected, now]);

  useGeoJsonLayer(map, {
    id: "transit-path",
    data: path,
    belowLabels: true,
    layers: (source) => [{ id: `${source}-line`, type: "line", source, layout: { "line-cap": "round" }, paint: { "line-color": MAP_INK.ice, "line-width": ["case", ["get", "uncertainty"], 12, 3], "line-opacity": ["case", ["get", "uncertainty"], 0.25, 0.6] } }],
  });

  useGeoJsonLayer(map, {
    id: "transit-vehicles",
    data: pipsReady && modesReady ? (gliding && step ? step : vehicles) : null,
    fadeBy: "trip",
    clickable: ["transit-vehicles-dot"],
    onClick: (f) => {
      const s: TripSegment | undefined = data?.find((x) => vehicleKey(x) === f.properties.trip);
      if (s) profile.open({ kind: "vehicle", id: vehicleKey(s), data: s });
    },
    layers: (source) => [
      {
        id: `${source}-dot`,
        type: "circle",
        source,
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, ["match", ["get", "group"], "bus", 1.4, 2.2], ICON_ZOOM - 1, ["match", ["get", "group"], "bus", 2.2, 3.2], ICON_ZOOM, 7, 17, 10],
          "circle-color": ["case", ["get", "selected"], MAP_INK.ice, MODE_COLOR],
          // Buses are the most numerous, so their dots stay faint until each one carries an icon.
          "circle-opacity": ["interpolate", ["linear"], ["zoom"], ICON_ZOOM - 1, ["*", ["get", "opacity"], ["case", ["get", "selected"], 1, ["match", ["get", "group"], "bus", 0.7, 0.95]]], ICON_ZOOM, ["get", "opacity"]],
          "circle-stroke-color": ["match", ["get", "delay"], "alarm", MAP_INK.alarm, "sodium", MAP_INK.sodium, MAP_INK.void],
          "circle-stroke-width": ["match", ["get", "delay"], "none", 0.8, 1.2],
          "circle-stroke-opacity": ["get", "opacity"],
        },
      },
      { ...ringIcon(source, {
        icon: ["concat", "transit-", ["get", "group"]],
        color: MAP_INK.void,
        minzoom: ICON_ZOOM - 0.5,
        px: [
          [ICON_ZOOM - 0.5, 7],
          [ICON_ZOOM, 9],
          [17, 13],
        ],
      }), paint: { "icon-color": MAP_INK.void, "icon-opacity": ["get", "opacity"] } },
      {
        id: `${source}-occupancy`,
        type: "symbol",
        source,
        minzoom: 14.5,
        filter: ["!=", ["get", "occ"], ""],
        layout: { "icon-image": ["get", "occ"], "icon-size": ["interpolate", ["linear"], ["zoom"], 14.5, 0.8, 18, 1.1], "icon-anchor": "bottom", "icon-offset": [0, -12], "icon-allow-overlap": true, "icon-ignore-placement": true },
        paint: { "icon-opacity": ["get", "opacity"] },
      },
      {
        id: `${source}-route`,
        type: "symbol",
        source,
        minzoom: 15.5,
        layout: { "text-field": ["get", "route"], "text-font": ["Noto Sans Regular"], "text-size": 9.5, "text-offset": [0, 1.4], "text-anchor": "top", "text-optional": true },
        paint: { "text-color": MODE_COLOR, "text-halo-color": MAP_INK.void, "text-halo-width": 1.2, "text-opacity": ["get", "opacity"] },
      },
    ],
  });
  return null;
}

/** Register the occupancy bars as map images. True once every one is available to symbol layers. */
function usePipIcons(map: MapLibreMap): boolean {
  const [ready, setReady] = useState(() => PIPS.every((p) => map.hasImage(p.name)));
  useEffect(() => {
    if (ready) return;
    let alive = true;
    void Promise.all(
      PIPS.map(async (pip) => {
        const img = new Image(48, 16);
        img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(pipSvg(pip))}`;
        await img.decode();
        const canvas = document.createElement("canvas");
        canvas.width = 48;
        canvas.height = 16;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.drawImage(img, 0, 0, 48, 16);
        if (alive && !map.hasImage(pip.name)) map.addImage(pip.name, ctx.getImageData(0, 0, 48, 16), { pixelRatio: 2 });
      }),
    ).then(() => alive && setReady(true));
    return () => {
      alive = false;
    };
  }, [map, ready]);
  return ready;
}
