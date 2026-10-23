import { useEffect, useMemo } from "react";
import { usePoll } from "../../app/core/hooks";
import { profile, useProfile } from "../../app/core/profile";
import { MAP_INK, useGeoJsonLayer, useMapIcon, useMapView, type MapLayerProps } from "../city/extension";
import { fetchEvents } from "./client";
import { EONET_ICON, EONET_ICON_SVG, ICON_NAMES, type IconName } from "./eonet-icons";
import type { EonetEvent } from "./types";

const TINT: Record<IconName, string> = { fire: MAP_INK.alarm, volcano: MAP_INK.alarm, storm: MAP_INK.sodium, wave: MAP_INK.sodium, dust: MAP_INK.sodium, sun: MAP_INK.sodium, ice: MAP_INK.fog, generic: MAP_INK.fog };

/** Open natural events from NASA EONET, with an icon per category and the path of storms and icebergs. */
export default function EonetLayer({ map, report }: MapLayerProps): null {
  const view = useMapView(map);
  // Ask for the visible area plus a margin, rounded so small pans reuse the same request.
  const pad = 2;
  const snap = (v: number): number => Math.round(v / pad) * pad;
  const box = { west: Math.max(-180, snap(view.west) - pad), south: Math.max(-90, snap(view.south) - pad), east: Math.min(180, snap(view.east) + pad), north: Math.min(90, snap(view.north) + pad) };
  const key = `${box.west},${box.south},${box.east},${box.north}`;
  const { data, error, loading } = usePoll((signal) => fetchEvents(box, signal), 10 * 60_000, [key]);
  const selected = useProfile((s) => (s.entity?.kind === "eonet" ? s.entity.id : null));
  useEffect(() => report({ loading: loading && !data, error: error?.message ?? null, count: data?.length ?? null }), [report, data, error, loading]);

  const ready = ICON_NAMES.map((name) => useMapIcon(map, `vantage-eonet-${name}`, EONET_ICON_SVG[name], { size: 48 }));
  const allReady = ready.every(Boolean);

  const points = useMemo(
    (): GeoJSON.FeatureCollection | null =>
      data
        ? {
            type: "FeatureCollection",
            features: data.map((e) => ({
              type: "Feature",
              properties: { id: e.id, icon: `vantage-eonet-${EONET_ICON[e.category]}`, tint: TINT[EONET_ICON[e.category]], selected: e.id === selected, label: e.title },
              geometry: { type: "Point", coordinates: [e.lon, e.lat] },
            })),
          }
        : null,
    [data, selected],
  );

  const tracks = useMemo((): GeoJSON.FeatureCollection | null => {
    const e: EonetEvent | undefined = data?.find((x) => x.id === selected);
    if (!e || e.track.length < 2) return null;
    return { type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: e.track } }] };
  }, [data, selected]);

  useGeoJsonLayer(map, {
    id: "hazards-eonet-track",
    data: tracks,
    belowLabels: true,
    layers: (source) => [{ id: `${source}-line`, type: "line", source, layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": MAP_INK.ice, "line-width": 2, "line-dasharray": [2, 2], "line-opacity": 0.85 } }],
  });

  useGeoJsonLayer(map, {
    id: "hazards-eonet",
    data: allReady ? points : null,
    fadeBy: "id",
    clickable: ["hazards-eonet-icon"],
    onClick: (f) => {
      const e = data?.find((x) => x.id === f.properties.id);
      if (e) profile.open({ kind: "eonet", id: e.id, data: e });
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
        id: `${source}-icon`,
        type: "symbol",
        source,
        layout: { "icon-image": ["get", "icon"], "icon-size": ["interpolate", ["linear"], ["zoom"], 2, 0.5, 8, 0.7, 12, 0.9], "icon-allow-overlap": true, "icon-ignore-placement": true },
        paint: { "icon-color": ["case", ["get", "selected"], MAP_INK.ice, ["get", "tint"]], "icon-opacity": 0.95 },
      },
      {
        id: `${source}-label`,
        type: "symbol",
        source,
        minzoom: 6,
        layout: { "text-field": ["get", "label"], "text-font": ["Noto Sans Regular"], "text-size": 10, "text-offset": [0, 1.4], "text-anchor": "top", "text-optional": true, "text-max-width": 12 },
        paint: { "text-color": ["case", ["get", "selected"], MAP_INK.ice, MAP_INK.fog], "text-halo-color": MAP_INK.void, "text-halo-width": 1.2 },
      },
    ],
  });

  return null;
}
