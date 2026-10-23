import type { Map as MapLibreMap } from "maplibre-gl";
import { useEffect, useMemo, useState } from "react";
import { profile, useProfile } from "../../app/core/profile";
import { destination } from "../../shared/geo";
import { MAP_INK, ringIcon, useGeoJsonLayer, useMapIcon, useMapView, type MapLayerProps } from "../city/extension";
import { useGrid } from "./client";
import { badgeSvg, iconName, markSvg } from "./icons";
import type { GridFeature, GridKind } from "./types";

/**
 * The street-grid layers that draw more than a marker: the area a camera watches, the dots of a signalled
 * junction, the lines of the power grid. Everything that is one mark on the map is a thing type instead,
 * declared in this plugin's manifest and drawn by City's things layer.
 */

/** Register the badge icons for these kinds. Returns true when all are ready. */
function useBadges(map: MapLibreMap, kinds: readonly GridKind[]): boolean {
  const [ready, setReady] = useState(false);
  const key = kinds.join(",");
  useEffect(() => {
    let alive = true;
    Promise.all(
      kinds.map(
        (kind) =>
          new Promise<void>((resolve) => {
            if (map.hasImage(iconName(kind))) return resolve();
            const img = new Image(64, 64);
            img.onload = () => {
              const canvas = document.createElement("canvas");
              canvas.width = 64;
              canvas.height = 64;
              canvas.getContext("2d")?.drawImage(img, 0, 0, 64, 64);
              const data = canvas.getContext("2d")?.getImageData(0, 0, 64, 64);
              if (data && !map.hasImage(iconName(kind))) map.addImage(iconName(kind), data, { pixelRatio: 2 });
              resolve();
            };
            img.onerror = () => resolve();
            img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(badgeSvg(kind))}`;
          }),
      ),
    ).then(() => alive && setReady(true));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, key]);
  return ready;
}

function openProfile(f: GridFeature): void {
  const g = f.geometry;
  const [lon, lat] = g.type === "Point" ? (g.coordinates as [number, number]) : (g.coordinates[Math.floor(g.coordinates.length / 2)] as [number, number]);
  profile.open({ kind: "grid", id: f.properties.osm, data: { ...f.properties, lat, lon } });
}

/** Points as map-only properties; the full feature stays in memory for the profiler. */
function toPoints(features: GridFeature[], selected: string | null): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: features
      .filter((f) => f.geometry.type === "Point")
      .map((f) => ({ type: "Feature", properties: { kind: f.properties.kind, osm: f.properties.osm, selected: f.properties.osm === selected }, geometry: f.geometry })),
  };
}

/** Viewing cone for a camera: a 60° wedge, 30 m long, for each mapped direction. */
function cone(lon: number, lat: number, bearing: number): number[][] {
  const pts: number[][] = [[lon, lat]];
  for (let a = -30; a <= 30; a += 6) {
    const p = destination({ lat, lon }, bearing + a, 30);
    pts.push([p.lon, p.lat]);
  }
  pts.push([lon, lat]);
  return pts;
}

const CAMERA_MARK = markSvg("camera");

/**
 * Surveillance cameras: small rings plus the area each one watches, where OpenStreetMap records it. The rings stay
 * below the size of other things on the map: there are many, and only the live cameras open to a picture.
 */
export function CameraLayer({ map, report }: MapLayerProps): null {
  const view = useMapView(map);
  const { features, loading, error } = useGrid(view, ["camera"]);
  const ready = useMapIcon(map, "grid-camera-mark", CAMERA_MARK);
  const selected = useProfile((s) => (s.entity?.kind === "grid" ? s.entity.id : null));
  useEffect(() => report({ loading: loading && features.length === 0, error, count: features.length }), [report, loading, error, features.length]);
  const byId = useMemo(() => new Map(features.map((f) => [f.properties.osm, f])), [features]);

  const coverage = useMemo((): GeoJSON.FeatureCollection => {
    const polys: GeoJSON.Feature[] = [];
    for (const f of features) {
      if (f.geometry.type !== "Point") continue;
      const [lon, lat] = f.geometry.coordinates as [number, number];
      const dome = f.properties.tags["camera:type"] === "dome" || f.properties.tags["camera:type"] === "panning";
      if (dome && f.properties.directions.length === 0) {
        const ring = Array.from({ length: 33 }, (_, i) => {
          const p = destination({ lat, lon }, i * 11.25, 18);
          return [p.lon, p.lat];
        });
        polys.push({ type: "Feature", properties: { osm: f.properties.osm }, geometry: { type: "Polygon", coordinates: [ring] } });
      }
      for (const d of f.properties.directions) polys.push({ type: "Feature", properties: { osm: f.properties.osm }, geometry: { type: "Polygon", coordinates: [cone(lon, lat, d)] } });
    }
    return { type: "FeatureCollection", features: polys };
  }, [features]);

  useGeoJsonLayer(map, {
    id: "grid-camera-cones",
    data: coverage,
    belowLabels: true,
    layers: (source) => [
      { id: `${source}-fill`, type: "fill", source, minzoom: 15.5, paint: { "fill-color": MAP_INK.alarm, "fill-opacity": 0.14 } },
      { id: `${source}-edge`, type: "line", source, minzoom: 15.5, paint: { "line-color": MAP_INK.alarm, "line-opacity": 0.45, "line-width": 0.8 } },
    ],
  });

  const points = useMemo(() => (ready ? toPoints(features, selected) : null), [ready, features, selected]);
  useGeoJsonLayer(map, {
    id: "grid-cameras",
    data: points,
    fadeBy: "osm",
    clickable: ["grid-cameras-ring"],
    onClick: (f) => {
      const hit = byId.get(String(f.properties.osm));
      if (hit) openProfile(hit);
    },
    layers: (source) => [
      { id: `${source}-selected`, type: "circle", source, filter: ["get", "selected"], paint: { "circle-radius": 14, "circle-color": MAP_INK.alarm, "circle-opacity": 0.14, "circle-stroke-color": MAP_INK.alarm, "circle-stroke-width": 1 } },
      {
        id: `${source}-ring`,
        type: "circle",
        source,
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 14, 2.5, 16, 4.5, 19, 7],
          "circle-color": MAP_INK.void,
          "circle-opacity": 0.9,
          "circle-stroke-color": MAP_INK.alarm,
          "circle-stroke-width": ["case", ["get", "selected"], 2, 1.2],
        },
      },
      { id: `${source}-core`, type: "circle", source, maxzoom: 16, paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 14, 1, 16, 1.8], "circle-color": MAP_INK.alarm } },
      ringIcon(source, { icon: "grid-camera-mark", color: MAP_INK.alarm, minzoom: 16, px: [[16, 6], [19, 9]] }),
    ],
  });
  return null;
}

/** Traffic signals: many per street, so small dots rather than badges. */
export function SignalLayer({ map, report }: MapLayerProps): null {
  const view = useMapView(map);
  const { features, loading, error } = useGrid(view, ["signal"]);
  const selected = useProfile((s) => (s.entity?.kind === "grid" ? s.entity.id : null));
  useEffect(() => report({ loading: loading && features.length === 0, error, count: features.length }), [report, loading, error, features.length]);
  const byId = useMemo(() => new Map(features.map((f) => [f.properties.osm, f])), [features]);
  const points = useMemo(() => toPoints(features, selected), [features, selected]);
  useGeoJsonLayer(map, {
    id: "grid-signals",
    data: points,
    fadeBy: "osm",
    clickable: ["grid-signals-dot"],
    onClick: (f) => {
      const hit = byId.get(String(f.properties.osm));
      if (hit) openProfile(hit);
    },
    layers: (source) => [
      {
        id: `${source}-dot`,
        type: "circle",
        source,
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 14, 1.6, 17, 3.5, 19, 5],
          "circle-color": ["case", ["get", "selected"], MAP_INK.ice, MAP_INK.bone],
          "circle-opacity": 0.85,
          "circle-stroke-color": MAP_INK.void,
          "circle-stroke-width": 1,
        },
      },
    ],
  });
  return null;
}

/** The power grid: transmission lines and substations. */
export function PowerLayer({ map, report }: MapLayerProps): null {
  const view = useMapView(map);
  const { features, loading, error } = useGrid(view, ["powerline", "substation"]);
  const ready = useBadges(map, ["substation"]);
  const selected = useProfile((s) => (s.entity?.kind === "grid" ? s.entity.id : null));
  useEffect(() => report({ loading: loading && features.length === 0, error, count: features.length }), [report, loading, error, features.length]);
  const byId = useMemo(() => new Map(features.map((f) => [f.properties.osm, f])), [features]);
  const lines = useMemo(
    (): GeoJSON.FeatureCollection => ({
      type: "FeatureCollection",
      features: features.filter((f) => f.geometry.type === "LineString").map((f) => ({ type: "Feature", properties: { osm: f.properties.osm, minor: f.properties.tags.power === "minor_line" }, geometry: f.geometry })),
    }),
    [features],
  );
  useGeoJsonLayer(map, {
    id: "grid-power-lines",
    data: lines,
    fadeBy: "osm",
    belowLabels: true,
    clickable: ["grid-power-lines-line"],
    onClick: (f) => {
      const hit = byId.get(String(f.properties.osm));
      if (hit) openProfile(hit);
    },
    layers: (source) => [
      { id: `${source}-glow`, type: "line", source, paint: { "line-color": MAP_INK.sodium, "line-width": 6, "line-opacity": 0.06, "line-blur": 4 } },
      { id: `${source}-line`, type: "line", source, paint: { "line-color": MAP_INK.sodium, "line-width": ["case", ["get", "minor"], 0.8, 1.4], "line-opacity": 0.55 } },
    ],
  });
  const points = useMemo(() => (ready ? toPoints(features, selected) : null), [ready, features, selected]);
  useGeoJsonLayer(map, {
    id: "grid-substations",
    data: points,
    fadeBy: "osm",
    clickable: ["grid-substations-badge"],
    onClick: (f) => {
      const hit = byId.get(String(f.properties.osm));
      if (hit) openProfile(hit);
    },
    layers: (source) => [
      { id: `${source}-badge`, type: "symbol", source, layout: { "icon-image": "grid-substation", "icon-size": ["interpolate", ["linear"], ["zoom"], 14, 0.6, 18, 0.9], "icon-allow-overlap": true } },
    ],
  });
  return null;
}
