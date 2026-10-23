import { useEffect, useMemo } from "react";
import { usePoll } from "../../app/core/hooks";
import { profile, useProfile } from "../../app/core/profile";
import { useSettings } from "../../app/core/settings";
import { MAP_INK, useGeoJsonLayer, useMapIcon, type MapLayerProps } from "../city/extension";
import { altitudeLabel, BALLOON_STALE_MS, fetchBalloonFlight, fetchBalloons } from "./client";
import { BALLOON_SVG } from "./SondesLayer";
import { splitAtDateline } from "./track";
import type { AmateurFlight, AmateurSnapshot } from "./types";

const POLL_MS = 5 * 60_000;

/** Balloons launched by radio amateurs, anywhere in the world, with the path they flew over the past three days. */
export default function BalloonsLayer({ map, report }: MapLayerProps): null {
  const units = useSettings((s) => s.units);
  const iconReady = useMapIcon(map, "vantage-balloon", BALLOON_SVG, { size: 64 });
  const selected = useProfile((s) => (s.entity?.kind === "amateurballoon" ? s.entity.id : null));
  const { data, error, loading } = usePoll((signal) => fetchBalloons(signal), POLL_MS, []);
  const flight = usePoll((signal) => fetchBalloonFlight(selected ?? "", signal), null, [selected], !selected);

  useEffect(() => {
    report({ loading: loading && !data, error: error?.message ?? null, count: data ? data.balloons.length : null });
  }, [report, data, error, loading]);

  const long = selected && flight.data?.id === selected ? flight.data : null;
  const built = useMemo(() => (data ? build(data, long, selected, units) : null), [data, long, selected, units]);

  useGeoJsonLayer(map, {
    id: "sondes-amateur-tracks",
    data: built?.tracks ?? null,
    fadeBy: "id",
    belowLabels: true,
    layers: (source) => [
      {
        id: `${source}-line`,
        type: "line",
        source,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": ["case", ["get", "selected"], MAP_INK.ice, MAP_INK.sodium],
          "line-width": ["case", ["get", "selected"], 2, 1.2],
          "line-opacity": ["case", ["get", "selected"], 0.85, ["get", "stale"], 0.15, 0.4],
        },
      },
    ],
  });

  useGeoJsonLayer(map, {
    id: "sondes-amateur",
    data: iconReady ? (built?.balloons ?? null) : null,
    fadeBy: "id",
    clickable: ["sondes-amateur-icon"],
    onClick: (feature) => {
      const b = data?.balloons.find((x) => x.id === String(feature.properties.id));
      if (b) profile.open({ kind: "amateurballoon", id: b.id, data: b });
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
        id: `${source}-icon`,
        type: "symbol",
        source,
        layout: {
          "icon-image": "vantage-balloon",
          "icon-size": ["interpolate", ["linear"], ["zoom"], 0, 0.42, 4, 0.58, 10, 0.8, 14, 1],
          "icon-anchor": "bottom",
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
          "symbol-sort-key": ["get", "alt"],
        },
        paint: { "icon-color": ["case", ["get", "selected"], MAP_INK.ice, MAP_INK.sodium], "icon-opacity": ["case", ["get", "stale"], 0.45, 1] },
      },
      {
        id: `${source}-label`,
        type: "symbol",
        source,
        minzoom: 3,
        layout: { "text-field": ["get", "label"], "text-font": ["Noto Sans Regular"], "text-size": 10, "text-offset": [0, 0.5], "text-anchor": "top", "text-letter-spacing": 0.08, "text-optional": true },
        paint: { "text-color": ["case", ["get", "selected"], MAP_INK.ice, MAP_INK.fog], "text-halo-color": MAP_INK.void, "text-halo-width": 1.2 },
      },
    ],
  });

  return null;
}

function build(snapshot: AmateurSnapshot, long: AmateurFlight | null, selected: string | null, units: "metric" | "imperial"): { balloons: GeoJSON.FeatureCollection; tracks: GeoJSON.FeatureCollection } {
  const balloons: GeoJSON.Feature[] = [];
  const tracks: GeoJSON.Feature[] = [];
  for (const b of snapshot.balloons) {
    const isSelected = b.id === selected;
    const stale = snapshot.fetchedAt - b.seenAt > BALLOON_STALE_MS;
    balloons.push({
      type: "Feature",
      properties: { id: b.id, selected: isSelected, stale, alt: b.altM, label: altitudeLabel(b.altM, units) },
      geometry: { type: "Point", coordinates: [b.lon, b.lat] },
    });
    // The selected balloon shows its whole year, the others the past three days.
    const path = isSelected && long ? long.points : b.track;
    const lines = splitAtDateline(path);
    if (lines.length > 0) tracks.push({ type: "Feature", properties: { id: b.id, selected: isSelected, stale }, geometry: { type: "MultiLineString", coordinates: lines } });
  }
  const collect = (features: GeoJSON.Feature[]): GeoJSON.FeatureCollection => ({ type: "FeatureCollection", features });
  return { balloons: collect(balloons), tracks: collect(tracks) };
}
