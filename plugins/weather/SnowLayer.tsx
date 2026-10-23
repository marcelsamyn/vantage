import { useEffect, useMemo, type ReactElement } from "react";
import { usePoll } from "../../app/core/hooks";
import { profile, useProfile } from "../../app/core/profile";
import { MAP_INK, useGeoJsonLayer, type MapLayerProps } from "../city/extension";
import { fetchSnow } from "./client";
import { Legend } from "./Legends";
import type { SnowStation } from "./types";
import "./weather.css";

function toFeatures(stations: readonly SnowStation[], selected: string | null): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    // Deepest last so the stations with the most snow end up on top.
    features: [...stations]
      .sort((a, b) => a.depthCm - b.depthCm)
      .map((s) => ({
        type: "Feature",
        properties: { code: s.code, depth: s.depthCm, fresh: s.fresh, selected: s.code === selected, label: `${Math.round(s.depthCm)} cm` },
        geometry: { type: "Point", coordinates: [s.lon, s.lat] },
      })),
  };
}

/** Snow depth at SLF's Alpine stations: a pale disc per station that grows with the snow, and a glow where it just snowed. */
export default function SnowLayer({ map, report }: MapLayerProps): ReactElement | null {
  const { data, error, loading } = usePoll((signal) => fetchSnow(signal), 10 * 60_000, []);
  const selected = useProfile((s) => (s.entity?.kind === "snowstation" ? s.entity.id : null));
  const byCode = useMemo(() => new Map((data?.stations ?? []).map((s) => [s.code, s])), [data]);
  const collection = useMemo(() => (data ? toFeatures(data.stations, selected) : null), [data, selected]);
  const withSnow = data ? data.stations.filter((s) => s.depthCm > 0).length : 0;
  const fresh = data ? data.stations.filter((s) => s.fresh).length : 0;

  useEffect(() => report({ loading: loading && !data, error: error?.message ?? null, count: data ? data.stations.length : null }), [report, data, error, loading]);

  useGeoJsonLayer(map, {
    id: "weather-snow",
    data: collection,
    fadeBy: "code",
    clickable: ["weather-snow-disc"],
    onClick: (feature) => {
      const s = byCode.get(String(feature.properties.code));
      if (s) profile.open({ kind: "snowstation", id: s.code, data: s });
    },
    layers: (source) => {
      // The disc area follows the depth, capped so a metre of snow does not hide the valley beneath it.
      const radius = (zoomFactor: number): unknown => ["min", 20 * zoomFactor, ["+", 3 * zoomFactor, ["*", 1.2 * zoomFactor, ["sqrt", ["get", "depth"]]]]];
      return [
        {
          id: `${source}-glow`,
          type: "circle",
          source,
          filter: ["get", "fresh"],
          paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 5, ["+", 10, ["*", 0.8, ["sqrt", ["get", "depth"]]]], 11, ["+", 22, ["*", 1.6, ["sqrt", ["get", "depth"]]]]], "circle-color": MAP_INK.sodium, "circle-opacity": 0.28, "circle-blur": 0.9 },
        },
        {
          id: `${source}-disc`,
          type: "circle",
          source,
          paint: {
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 5, radius(0.7), 11, radius(1.4)] as never,
            "circle-color": ["case", [">", ["get", "depth"], 0], MAP_INK.bone, MAP_INK.void],
            "circle-opacity": ["case", [">", ["get", "depth"], 0], 0.82, 0.55],
            "circle-stroke-color": ["case", ["get", "selected"], MAP_INK.ice, ["get", "fresh"], MAP_INK.sodium, [">", ["get", "depth"], 0], MAP_INK.bone, MAP_INK.ash],
            "circle-stroke-width": ["case", ["get", "selected"], 2.5, ["get", "fresh"], 2, 1],
          },
        },
        {
          id: `${source}-depth`,
          type: "symbol",
          source,
          minzoom: 8,
          layout: { "text-field": ["get", "label"], "text-font": ["Noto Sans Regular"], "text-size": 11, "text-offset": [0, 1.6], "text-anchor": "top", "text-optional": true },
          paint: { "text-color": MAP_INK.bone, "text-halo-color": MAP_INK.void, "text-halo-width": 1.2 },
        },
      ];
    },
  });

  if (!data) return null;
  return (
    <Legend>
      <div className="weather-legend weather-sat" role="group" aria-label="Alpine snow stations">
        <div className="weather-sat__head">
          <span className="v-eyebrow">Snow depth · Swiss Alps</span>
          <span className="weather-sat__delay num">
            {withSnow} of {data.stations.length} stations have snow
            {fresh > 0 && <b className="weather-snow__fresh"> · {fresh} with fresh snow</b>}
          </span>
        </div>
        <div className="weather-legend__note">
          Each disc grows with the depth; a glow means the snow rose at least 5 cm in six hours. {data.networkSize - data.stations.length} of the network's {data.networkSize} stations measure only wind. Switzerland and Liechtenstein only. Readings every 30 minutes: WSL Institute for Snow and Avalanche Research SLF, CC BY 4.0.
        </div>
      </div>
    </Legend>
  );
}
