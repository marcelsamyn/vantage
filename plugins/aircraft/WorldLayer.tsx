import type { ExpressionSpecification } from "maplibre-gl";
import { useEffect, useMemo, type ReactElement } from "react";
import { useMotionNow, usePoll } from "../../app/core/hooks";
import { profile, useProfile } from "../../app/core/profile";
import { MAP_INK, useGeoJsonLayer, useMapIcons, useMapPulse, useMapView, type MapLayerProps } from "../city/extension";
import { nearView } from "./view";
import { projected } from "./client";
import { CRAFT_ICONS, SHAPES, craftIcon, craftIconSize, craftOf } from "./shapes";
import type { Aircraft, WorldwideSnapshot } from "./types";

export interface WorldLayerSpec {
  /** Map source id, unique on the map. */
  id: string;
  load: (signal: AbortSignal) => Promise<WorldwideSnapshot>;
  intervalMs: number;
  /** Colour of the aircraft; a selected aircraft is always ice. */
  ink: string;
  /** Pulse a ring around each aircraft. For things that need attention. */
  pulse: boolean;
  label: (a: Aircraft) => string;
  labelMinZoom: number;
}

const FRAME_MS = 500;
const PULSE_PERIOD_MS = 2200;

/** A worldwide list of aircraft on the map: the same silhouettes as the live layer, moved between polls by dead reckoning. */
export function WorldLayer({ map, report, spec }: MapLayerProps & { spec: WorldLayerSpec }): ReactElement | null {
  const iconReady = useMapIcons(map, CRAFT_ICONS);
  const selected = useProfile((s) => (s.entity?.kind === "aircraft" ? s.entity.id : null));
  const { data, error, loading } = usePoll(spec.load, spec.intervalMs, [spec.id]);

  useEffect(() => {
    report({ loading: loading && !data, error: error?.message ?? null, count: data ? data.aircraft.length : null });
  }, [report, data, error, loading]);

  const view = useMapView(map);
  const gliding = useMemo(() => data?.aircraft.some((a) => !a.onGround && nearView(a, view)) ?? false, [data, view]);
  // Whole frames, as in AircraftLayer: renders inside one frame reuse `planes` and skip the map source update.
  const frame = Math.floor(useMotionNow(gliding ? FRAME_MS : null) / FRAME_MS);

  const planes = useMemo((): GeoJSON.FeatureCollection | null => {
    if (!data) return null;
    return {
      type: "FeatureCollection",
      features: data.aircraft.map((a) => {
        const p = projected(a, data.fetchedAt, frame * FRAME_MS);
        const craft = craftOf(a);
        return {
          type: "Feature",
          properties: { hex: a.hex, label: spec.label(a), icon: craftIcon(craft), scale: SHAPES[craft].scale, track: a.trackDeg ?? 0, ground: a.onGround, selected: a.hex === selected },
          geometry: { type: "Point", coordinates: [p.lon, p.lat] },
        };
      }),
    };
  }, [data, frame, selected, spec]);

  // The ring grows and fades, once every couple of seconds.
  const ringId = `${spec.id}-pulse`;
  useMapPulse(map, ringId, PULSE_PERIOD_MS, (phase) => [["circle-radius", 10 + 24 * phase], ["circle-stroke-opacity", 0.85 * (1 - phase)]], spec.pulse && (planes?.features.length ?? 0) > 0);

  const tint: ExpressionSpecification = ["case", ["get", "selected"], MAP_INK.ice, spec.ink];
  useGeoJsonLayer(map, {
    id: spec.id,
    data: iconReady ? planes : null,
    fadeBy: "hex",
    clickable: [`${spec.id}-icon`],
    onClick: (feature) => {
      const a = data?.aircraft.find((x) => x.hex === String(feature.properties.hex));
      if (a && data) profile.open({ kind: "aircraft", id: a.hex, data: { ...a, fetchedAt: data.fetchedAt } });
    },
    layers: (source) => [
      ...(spec.pulse
        ? [
            {
              id: ringId,
              type: "circle" as const,
              source,
              paint: { "circle-radius": 14, "circle-color": spec.ink, "circle-opacity": 0.1, "circle-stroke-color": spec.ink, "circle-stroke-width": 1.5, "circle-stroke-opacity": 0.5 },
            },
          ]
        : []),
      {
        id: `${source}-icon`,
        type: "symbol",
        source,
        layout: {
          "icon-image": ["get", "icon"],
          "icon-size": craftIconSize([
            [0, 0.4],
            [5, 0.5],
            [10, 0.62],
            [15, 0.7],
          ]),
          "icon-rotate": ["get", "track"],
          "icon-rotation-alignment": "map",
          "icon-pitch-alignment": "map",
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
        },
        paint: { "icon-color": tint, "icon-opacity": ["case", ["get", "ground"], 0.5, 1] },
      },
      {
        id: `${source}-label`,
        type: "symbol",
        source,
        minzoom: spec.labelMinZoom,
        layout: {
          "text-field": ["get", "label"],
          "text-font": ["Noto Sans Regular"],
          "text-size": 11,
          "text-offset": [0, 1.5],
          "text-anchor": "top",
          "text-letter-spacing": 0.06,
          "text-optional": true,
        },
        paint: { "text-color": ["case", ["get", "selected"], MAP_INK.ice, spec.ink], "text-halo-color": MAP_INK.void, "text-halo-width": 1.4 },
      },
    ],
  });

  return null;
}
