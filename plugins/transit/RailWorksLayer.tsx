import { Construction } from "lucide-react";
import type { ExpressionSpecification } from "maplibre-gl";
import { useEffect, useMemo } from "react";
import { usePoll, usePrefersReducedMotion } from "../../app/core/hooks";
import { profile, useProfile } from "../../app/core/profile";
import { distanceM } from "../../shared/geo";
import { MAP_INK, ringIcon, useGeoJsonLayer, useMapIcon, type MapLayerProps } from "../city/extension";
import { fetchRailWorks } from "./client";
import type { RailWorks } from "./types";

/** Belgium's extent: Infrabel runs nothing else, so the first time the layer opens elsewhere it brings Belgium into view. */
const BELGIUM: [[number, number], [number, number]] = [
  [2.5, 49.5],
  [6.4, 51.5],
];
const BELGIUM_CENTRE = { lat: 50.6, lon: 4.5 };

const INK: ExpressionSpecification = ["case", ["get", "selected"], MAP_INK.ice, ["get", "major"], MAP_INK.alarm, MAP_INK.sodium];

function draw(data: RailWorks, selected: string | null): { lines: GeoJSON.FeatureCollection; dots: GeoJSON.FeatureCollection } {
  const props = (w: RailWorks["works"][number]): GeoJSON.GeoJsonProperties => ({ id: w.id, major: w.impact === "Major", started: w.started, selected: w.id === selected });
  return {
    lines: { type: "FeatureCollection", features: data.works.map((w) => ({ type: "Feature", properties: props(w), geometry: { type: "MultiLineString", coordinates: w.shape } })) },
    // Many restrictions cover a few metres of track at a station: a dot keeps them findable from far away.
    dots: {
      type: "FeatureCollection",
      features: data.works.flatMap((w) => {
        const at = w.shape[0]?.[0];
        return at ? [{ type: "Feature" as const, properties: props(w), geometry: { type: "Point" as const, coordinates: at } }] : [];
      }),
    },
  };
}

/**
 * Infrabel's planned track restrictions for the next four months. Red is a major impact, amber a minor one; a solid
 * line is in force today and a dashed one starts later. Each is a stretch of real track, so zoom in to find it.
 */
export default function RailWorksLayer({ map, report, claimFraming }: MapLayerProps): null {
  const { data, error } = usePoll((signal) => fetchRailWorks(signal), 30 * 60_000, []);
  const selected = useProfile((s) => (s.entity?.kind === "railwork" ? s.entity.id : null));
  const icon = useMapIcon(map, "transit-works", Construction);
  const reduced = usePrefersReducedMotion();
  const drawn = useMemo(() => (data ? draw(data, selected) : null), [data, selected]);

  useEffect(() => {
    report({ loading: !data && !error, error: data ? null : (error?.message ?? null), count: data?.works.length ?? null });
  }, [report, data, error]);

  useEffect(() => {
    if (!data || !claimFraming()) return;
    const c = map.getCenter();
    if (distanceM({ lat: c.lat, lon: c.lng }, BELGIUM_CENTRE) > 250_000) map.fitBounds(BELGIUM, { padding: 60, duration: reduced ? 0 : 1400, maxZoom: 8 });
  }, [map, data, reduced, claimFraming]);

  const open = (id: string): void => {
    const work = data?.works.find((w) => w.id === id);
    if (work) profile.open({ kind: "railwork", id: work.id, data: work });
  };

  useGeoJsonLayer(map, {
    id: "transit-works-dot",
    data: icon ? (drawn?.dots ?? null) : null,
    fadeBy: "id",
    clickable: ["transit-works-dot-ring"],
    onClick: (f) => open(String(f.properties.id)),
    layers: (source) => [
      {
        id: `${source}-ring`,
        type: "circle",
        source,
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 6, 4, 10, 7.5],
          "circle-color": MAP_INK.void,
          "circle-stroke-width": 2,
          "circle-stroke-color": INK,
          "circle-stroke-opacity": ["case", ["get", "started"], 1, 0.6],
        },
      },
      ringIcon(source, { icon: "transit-works", color: INK, minzoom: 8, px: [[8, 7], [10, 10]] }),
    ],
  });

  useGeoJsonLayer(map, {
    id: "transit-works",
    data: drawn?.lines ?? null,
    fadeBy: "id",
    belowLabels: true,
    clickable: ["transit-works-hit"],
    onClick: (f) => open(String(f.properties.id)),
    layers: (source) => [
      { id: `${source}-glow`, type: "line", source, layout: { "line-cap": "round" }, paint: { "line-color": ["case", ["get", "major"], MAP_INK.alarm, MAP_INK.sodium], "line-opacity": 0.2, "line-width": ["interpolate", ["linear"], ["zoom"], 6, 6, 12, 14], "line-blur": 3 } },
      {
        id: `${source}-line`,
        type: "line",
        source,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": ["case", ["get", "selected"], MAP_INK.ice, ["get", "major"], MAP_INK.alarm, MAP_INK.sodium],
          "line-width": ["interpolate", ["linear"], ["zoom"], 6, 2, 12, 4],
          "line-opacity": ["case", ["get", "started"], 0.95, 0.6],
        },
      },
      { id: `${source}-later`, type: "line", source, filter: ["!", ["get", "started"]], paint: { "line-color": MAP_INK.void, "line-width": ["interpolate", ["linear"], ["zoom"], 6, 1, 12, 2], "line-dasharray": [2, 2] } },
      // A wide invisible line makes thin track easy to click.
      { id: `${source}-hit`, type: "line", source, paint: { "line-color": MAP_INK.void, "line-opacity": 0, "line-width": 16 } },
    ],
  });

  return null;
}
