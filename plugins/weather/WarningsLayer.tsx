import { useEffect, useMemo, useState, type ReactElement } from "react";
import { useNow } from "../../app/core/hooks";
import { profile } from "../../app/core/profile";
import { MAP_INK, useGeoJsonLayer, type MapLayerProps } from "../city/extension";
import { isActive, LEVEL_RANK, LEVEL_WORDS, useWarnings } from "./client";
import { Legend } from "./Legends";
import type { OfficialWarning, WarningLevel } from "./types";
import "./weather.css";

type When = "now" | "later";

/** Warnings as map features: one outline per warning, strongest drawn last so it ends up on top. */
function toFeatures(warnings: OfficialWarning[], areas: Map<string, GeoJSON.Polygon | GeoJSON.MultiPolygon>): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  for (const w of [...warnings].sort((a, b) => LEVEL_RANK[a.level] - LEVEL_RANK[b.level])) {
    const geometry = w.areaId ? areas.get(w.areaId) : undefined;
    if (geometry) features.push({ type: "Feature", properties: { id: w.id, level: w.level, rank: LEVEL_RANK[w.level] }, geometry });
  }
  return { type: "FeatureCollection", features };
}

/**
 * Official weather and civil-protection warnings: MeteoAlarm for Italy, Belgium and the country you are in,
 * plus Italy's Civil Protection zones. Yellow, orange and red follow the European colour code.
 */
export default function WarningsLayer({ map, report }: MapLayerProps): ReactElement | null {
  const { data, error, loading } = useWarnings();
  const now = useNow(60_000);
  const [when, setWhen] = useState<When>("now");

  const shown = useMemo(() => (data ? data.warnings.filter((w) => (when === "now" ? isActive(w, now) : w.from * 1000 > now)) : []), [data, when, now]);
  const areas = useMemo(() => new Map((data?.areas ?? []).map((a) => [a.id, a.geometry])), [data]);
  const byId = useMemo(() => new Map((data?.warnings ?? []).map((w) => [w.id, w])), [data]);
  const collection = useMemo(() => toFeatures(shown, areas), [shown, areas]);
  const unmapped = shown.filter((w) => !w.areaId).length;

  useEffect(() => report({ loading: loading && !data, error: error?.message ?? null, count: data ? shown.length : null }), [report, data, error, loading, shown.length]);

  useGeoJsonLayer(map, {
    id: "weather-warnings",
    data: data ? collection : null,
    fadeBy: "id",
    belowLabels: true,
    clickable: ["weather-warnings-fill"],
    onClick: (feature) => {
      const w = byId.get(String(feature.properties.id));
      if (w) profile.open({ kind: "warning", id: w.id, data: w });
    },
    layers: (source) => {
      const colour = ["match", ["get", "level"], "red", MAP_INK.alarm, MAP_INK.sodium];
      return [
        {
          id: `${source}-fill`,
          type: "fill",
          source,
          layout: { "fill-sort-key": ["get", "rank"] },
          // Warning areas are huge: fade the tint once you are close enough that the outline says enough.
          paint: {
            "fill-color": colour as never,
            "fill-opacity": ["interpolate", ["linear"], ["zoom"], 6, ["match", ["get", "level"], "yellow", 0.16, "orange", 0.42, 0.5], 12, ["match", ["get", "level"], "yellow", 0.05, "orange", 0.12, 0.16]],
          },
        },
        { id: `${source}-edge`, type: "line", source, layout: { "line-sort-key": ["get", "rank"] }, paint: { "line-color": colour as never, "line-opacity": ["match", ["get", "level"], "yellow", 0.5, 0.95], "line-width": ["match", ["get", "level"], "yellow", 0.8, 1.6] } },
      ];
    },
  });

  if (!data) return null;
  const counts = (["red", "orange", "yellow"] as WarningLevel[]).map((l) => [l, shown.filter((w) => w.level === l).length] as const);
  return (
    <Legend>
      <div className="weather-legend" role="group" aria-label="Official warnings">
        <div className="weather-legend__row">
          <div className="weather-legend__keys">
            {counts.map(([level, n]) => (
              <span key={level} className="num">
                <i className={`weather-legend__swatch weather-legend__swatch--${level}`} />
                {LEVEL_WORDS[level]} {n}
              </span>
            ))}
          </div>
          <div className="weather-legend__when">
            {(["now", "later"] as const).map((w) => (
              <button key={w} type="button" aria-pressed={when === w} className="weather-legend__btn" onClick={() => setWhen(w)}>
                {w === "now" ? "In force now" : "Starting later"}
              </button>
            ))}
          </div>
        </div>
        {unmapped > 0 && <div className="weather-legend__note">{unmapped} more {unmapped === 1 ? "has" : "have"} no area outline in the feed, so {unmapped === 1 ? "it cannot" : "they cannot"} be drawn.</div>}
        {data.failed.length > 0 && <div className="weather-legend__note weather-legend__note--bad">Not loaded: {data.failed.map((f) => f.source).join(", ")}.</div>}
      </div>
    </Legend>
  );
}
