import type { ExpressionSpecification, Map as MapLibreMap, MapGeoJSONFeature, SymbolLayerSpecification } from "maplibre-gl";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMotionNow, usePoll } from "../../app/core/hooks";
import { profile, useProfile } from "../../app/core/profile";
import { distanceM } from "../../shared/geo";
import { MAP_INK, useGeoJsonLayer, useMapIcons, useMapView, type MapLayerProps } from "../city/extension";
import { AROUND_NM, fetchNear, projected, useTraffic } from "./client";
import { useLocation } from "../../app/core/location";
import { emergencyOf } from "./emergency";
import { useFollow } from "./follow";
import { CRAFT_ICONS, SHAPES, craftFootprint, craftIcon, craftIconSize, craftOf, mastFootprint, metresPerPixel, type Craft, type SizeStops } from "./shapes";
import type { Aircraft, AircraftSnapshot } from "./types";
import { nearView } from "./view";

const TRAIL_POINTS = 30;
const HALO_ICON = "vantage-aircraft-halo";
/** The silhouettes, and the ring that marks a selected or emergency aircraft in 3D, where a flat circle cannot rise. */
const ICONS = [...CRAFT_ICONS, { name: HALO_ICON, load: () => Promise.resolve('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><circle cx="24" cy="24" r="21" fill="none" stroke="#fff" stroke-width="2.5"/></svg>'), size: 64 }];

/** Colour by altitude in feet: mint near the ground, sodium at mid levels, bone at cruise. */
const ALTITUDE_INK: ExpressionSpecification = ["interpolate-hcl", ["linear"], ["get", "alt"], 0, MAP_INK.mint, 10_000, MAP_INK.sodium, 35_000, MAP_INK.bone];
const FRAME_MS = 120;
const FT_TO_M = 0.3048;

/** Icon size by zoom; a feature's `scale` multiplies it. A 64 px icon at size 1 is 32 CSS px. */
const ICON_SIZE: SizeStops = [
  [5, 0.32],
  [10, 0.48],
  [15, 0.62],
];

function iconSizeAt(zoom: number): number {
  const first = ICON_SIZE[0] ?? [0, 1];
  let size = first[1];
  for (let i = 1; i < ICON_SIZE.length; i++) {
    const [z0, s0] = ICON_SIZE[i - 1] ?? first;
    const [z1, s1] = ICON_SIZE[i] ?? first;
    if (zoom >= z1) size = s1;
    else if (zoom > z0) size = s0 + ((s1 - s0) * (zoom - z0)) / (z1 - z0);
  }
  return size;
}

/** Live aircraft on the City map, moved smoothly between polls by dead reckoning, with short trails. Tilted, they fly as solids at their altitude. */
export default function AircraftLayer({ map, report }: MapLayerProps): null {
  const view = useMapView(map);
  const iconReady = useMapIcons(map, ICONS);
  const camera = useCamera(map);
  const selected = useProfile((s) => (s.entity?.kind === "aircraft" ? s.entity.id : null));
  const follow = useFollow((s) => s.hex);

  // Cover the visible area, capped at the feed's 250 nm limit. When the view lies inside the area the
  // aircraft watcher already tracks around you, reuse its data instead of asking the network again.
  const radiusNm = Math.min(250, (distanceM(view.center, { lat: view.north, lon: view.east }) / 1852) * 1.1);
  const here = useLocation((st) => st.here);
  const watched = useTraffic((st) => st.snapshot);
  const covered = here !== null && watched !== null && distanceM(here, view.center) / 1852 + radiusNm <= AROUND_NM;
  const key = `${view.center.lat.toFixed(2)},${view.center.lon.toFixed(2)},${Math.round(radiusNm / 10)}`;
  const own = usePoll((signal) => fetchNear(view.center, radiusNm, signal), 10_000, [key], covered);
  const data = covered ? watched : own.data;
  const error = covered ? null : own.error;
  const loading = !covered && own.loading;

  const trails = useRef(new Map<string, [number, number][]>());
  useEffect(() => {
    if (!data) return;
    const live = new Set<string>();
    for (const a of data.aircraft) {
      live.add(a.hex);
      const trail = trails.current.get(a.hex) ?? [];
      const last = trail[trail.length - 1];
      if (!last || last[0] !== a.lon || last[1] !== a.lat) trail.push([a.lon, a.lat]);
      trails.current.set(a.hex, trail.slice(-TRAIL_POINTS));
    }
    for (const hex of trails.current.keys()) if (!live.has(hex)) trails.current.delete(hex);
  }, [data]);

  useEffect(() => {
    report({ loading: loading && !data, error: error?.message ?? null, count: data ? data.aircraft.length : null });
  }, [report, data, error, loading]);

  // Glide aircraft between polls while someone watches and one flies in or near the view; otherwise they move
  // when new positions arrive. Every glide step redraws the whole map.
  const gliding = useMemo(() => data?.aircraft.some((a) => !a.onGround && nearView(a, view)) ?? false, [data, view]);
  // `useMotionNow` reads the clock on every render. Counting whole frames keeps `planes`, and so the map source's
  // `setData`, stable across renders inside one frame, such as a loading toggle.
  const frame = Math.floor(useMotionNow(gliding ? FRAME_MS : null) / FRAME_MS);

  const planes = useMemo(() => (data ? toFeatures(data, frame * FRAME_MS, selected, camera.tilted) : null), [data, frame, selected, camera.tilted]);
  const solids = useMemo(() => (planes && camera.tilted ? toSolids(planes, camera.zoom) : null), [planes, camera]);
  const trailLines = useMemo((): GeoJSON.FeatureCollection | null => {
    if (!data || !planes) return null;
    const features: GeoJSON.Feature[] = [];
    for (const f of planes.features) {
      const hex = f.properties.hex;
      const trail = trails.current.get(hex);
      if (!trail?.length) continue;
      const head = f.geometry.coordinates;
      features.push({ type: "Feature", properties: { hex, alt: f.properties.alt, selected: hex === selected }, geometry: { type: "LineString", coordinates: [...trail, head] } });
    }
    return { type: "FeatureCollection", features };
  }, [data, planes, selected]);

  // Dragging the map ends following.
  useEffect(() => {
    const stop = (): void => useFollow.getState().set(null);
    map.on("dragstart", stop);
    return () => {
      map.off("dragstart", stop);
    };
  }, [map]);

  // Keep a followed aircraft centred.
  useEffect(() => {
    if (!follow || !planes) return;
    const f = planes.features.find((p) => p.properties?.hex === follow);
    if (f) map.easeTo({ center: (f.geometry as GeoJSON.Point).coordinates as [number, number], duration: FRAME_MS, easing: (t) => t });
  }, [map, follow, planes]);

  useGeoJsonLayer(map, {
    id: "aircraft-trails",
    data: trailLines,
    fadeBy: "hex",
    belowLabels: true,
    layers: (source) => [
      {
        id: `${source}-line`,
        type: "line",
        source,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": ["case", ["get", "selected"], MAP_INK.ice, ALTITUDE_INK], "line-width": ["case", ["get", "selected"], 2, 1.2], "line-opacity": ["case", ["get", "selected"], 0.8, 0.28] },
      },
    ],
  });

  const open = (feature: MapGeoJSONFeature): void => {
    const hex = String(feature.properties.hex);
    const a = data?.aircraft.find((x) => x.hex === hex);
    if (a && data) profile.open({ kind: "aircraft", id: hex, data: { ...a, fetchedAt: data.fetchedAt } });
  };
  const tint: ExpressionSpecification = ["case", ["get", "selected"], MAP_INK.ice, ["get", "emergency"], MAP_INK.alarm, ALTITUDE_INK];
  const silhouette: SymbolLayerSpecification["layout"] = {
    "icon-image": ["get", "icon"],
    "icon-size": craftIconSize(ICON_SIZE),
    "icon-rotate": ["get", "track"],
    "icon-rotation-alignment": "map",
    "icon-pitch-alignment": "map",
    "icon-allow-overlap": true,
    "icon-ignore-placement": true,
  };

  // Tilted, each aircraft leaves its silhouette on the ground below it. A black shadow vanishes on the dark map, so
  // the shadow is a faint print of the aircraft's own colour. Below the solids and the labels, so it never covers
  // the aircraft it belongs to.
  useGeoJsonLayer(map, {
    id: "aircraft-shadows",
    data: iconReady && camera.tilted ? planes : null,
    fadeBy: "hex",
    belowLabels: true,
    clickable: ["aircraft-shadows-icon"],
    onClick: open,
    layers: (source) => [{ id: `${source}-icon`, type: "symbol", source, layout: silhouette, paint: { "icon-color": tint, "icon-opacity": ["case", ["get", "ground"], 0, 0.3] } }],
  });

  useGeoJsonLayer(map, {
    id: "aircraft-solids",
    data: solids,
    clickable: ["aircraft-solids-body"],
    onClick: open,
    layers: (source) => [
      {
        id: `${source}-mast`,
        type: "fill-extrusion",
        source,
        filter: ["==", ["get", "part"], "mast"],
        paint: { "fill-extrusion-color": tint, "fill-extrusion-height": ["get", "top"], "fill-extrusion-base": 0, "fill-extrusion-opacity": 0.35, "fill-extrusion-vertical-gradient": false },
      },
      {
        id: `${source}-body`,
        type: "fill-extrusion",
        source,
        filter: ["==", ["get", "part"], "body"],
        paint: { "fill-extrusion-color": tint, "fill-extrusion-height": ["get", "top"], "fill-extrusion-base": ["get", "base"], "fill-extrusion-vertical-gradient": false },
      },
    ],
  });

  useGeoJsonLayer(map, {
    id: "aircraft-planes",
    data: iconReady ? planes : null,
    fadeBy: "hex",
    clickable: ["aircraft-planes-icon"],
    onClick: open,
    layers: (source) => [
      {
        id: `${source}-halo`,
        type: "circle",
        source,
        filter: ["all", ["!", ["get", "lifted"]], ["any", ["get", "selected"], ["get", "emergency"]]],
        paint: { "circle-radius": 18, "circle-color": tint, "circle-opacity": 0.12, "circle-stroke-color": tint, "circle-stroke-width": 1, "circle-stroke-opacity": 0.6 },
      },
      {
        id: `${source}-ring`,
        type: "symbol",
        source,
        filter: ["all", ["get", "lifted"], ["any", ["get", "selected"], ["get", "emergency"]]],
        layout: { "icon-image": HALO_ICON, "icon-size": 1.15, "icon-allow-overlap": true, "icon-ignore-placement": true, "symbol-height-offset": ["get", "lift"] },
        paint: { "icon-color": tint, "icon-opacity": 0.7 },
      },
      {
        id: `${source}-icon`,
        type: "symbol",
        source,
        filter: ["!", ["get", "lifted"]],
        layout: { ...silhouette, "symbol-sort-key": ["get", "alt"] },
        paint: { "icon-color": tint, "icon-opacity": ["case", ["get", "ground"], 0.45, 1] },
      },
      {
        id: `${source}-label`,
        type: "symbol",
        source,
        minzoom: 8,
        layout: {
          "text-field": ["get", "label"],
          "text-font": ["Noto Sans Regular"],
          "text-size": 10,
          "text-offset": [0, 1.6],
          "text-anchor": "top",
          "text-letter-spacing": 0.08,
          "text-optional": true,
          "symbol-height-offset": ["get", "lift"],
        },
        paint: { "text-color": ["case", ["get", "selected"], MAP_INK.ice, MAP_INK.fog], "text-halo-color": MAP_INK.void, "text-halo-width": 1.2 },
      },
    ],
  });

  return null;
}

/** Whether the map is tilted into 3D, and its zoom in quarter steps: solids are resized only when it moves a step. */
function useCamera(map: MapLibreMap): Camera {
  const [camera, setCamera] = useState(() => readCamera(map));
  useEffect(() => {
    const update = (): void => {
      const next = readCamera(map);
      setCamera((prev) => (prev.tilted === next.tilted && prev.zoom === next.zoom ? prev : next));
    };
    map.on("pitch", update);
    map.on("zoom", update);
    return () => {
      map.off("pitch", update);
      map.off("zoom", update);
    };
  }, [map]);
  return camera;
}

interface Camera {
  tilted: boolean;
  zoom: number;
}

// The same threshold as the City map's "Tilt to 3D" control.
const readCamera = (map: MapLibreMap): Camera => ({ tilted: map.getPitch() >= 10, zoom: Math.round(map.getZoom() * 4) / 4 });

/**
 * Each aircraft as a solid: its silhouette lifted to its altitude, true to scale and never smaller than its icon,
 * with a thin mast down to its shadow so the eye can tell how high it flies.
 */
function toSolids(planes: Planes, zoom: number): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  for (const plane of planes.features) {
    const [lon = 0, lat = 0] = plane.geometry.coordinates;
    const { hex, craft, scale, track, alt, lift: base, selected, emergency } = plane.properties;
    const mpp = metresPerPixel(zoom, lat);
    const sizeM = Math.max(SHAPES[craft].sizeM, iconSizeAt(zoom) * 32 * scale * mpp);
    const properties = { hex, alt, selected, emergency };
    features.push({ type: "Feature", properties: { ...properties, part: "body", base, top: base + sizeM * 0.05 }, geometry: craftFootprint(craft, lon, lat, track, sizeM) });
    if (base > 0) features.push({ type: "Feature", properties: { ...properties, part: "mast", top: base }, geometry: mastFootprint(lon, lat, 1.5 * mpp) });
  }
  return { type: "FeatureCollection", features };
}

interface PlaneProps {
  hex: string;
  label: string;
  icon: string;
  craft: Craft;
  scale: number;
  track: number;
  alt: number;
  ground: boolean;
  emergency: boolean;
  selected: boolean;
  /** Drawn as a solid in 3D, so the flat icon stays hidden. */
  lifted: boolean;
  /** Metres above the ground where the solid, its label and its ring sit in 3D; 0 in 2D. */
  lift: number;
}

type Planes = GeoJSON.FeatureCollection<GeoJSON.Point, PlaneProps>;

function toFeatures(snapshot: AircraftSnapshot, now: number, selected: string | null, lifted: boolean): Planes {
  return {
    type: "FeatureCollection",
    features: snapshot.aircraft.map((a: Aircraft) => {
      const p = projected(a, snapshot.fetchedAt, now);
      const alt = a.altFt === null ? "" : a.altFt >= 18_000 ? ` FL${Math.round(a.altFt / 100)}` : ` ${Math.round(a.altFt / 100) * 100}ft`;
      const craft = craftOf(a);
      return {
        type: "Feature",
        properties: {
          hex: a.hex,
          label: `${a.callsign ?? a.registration ?? a.hex.toUpperCase()}${alt}`,
          icon: craftIcon(craft),
          craft,
          scale: SHAPES[craft].scale,
          track: a.trackDeg ?? 0,
          alt: a.altFt ?? 0,
          ground: a.onGround,
          emergency: emergencyOf(a) !== null,
          selected: a.hex === selected,
          lifted,
          // Airfields near sea level report slightly negative altitudes; the map draws nothing below ground.
          lift: lifted && !a.onGround ? Math.max(0, (a.altFt ?? 0) * FT_TO_M) : 0,
        },
        geometry: { type: "Point", coordinates: [p.lon, p.lat] },
      };
    }),
  };
}
