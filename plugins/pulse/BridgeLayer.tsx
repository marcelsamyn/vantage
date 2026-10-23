import { useEffect, useMemo } from "react";
import { fmt } from "../../app/core/format";
import { useNow } from "../../app/core/hooks";
import { profile, useProfile } from "../../app/core/profile";
import { MAP_INK, useGeoJsonLayer, useMapPulse, type MapLayerProps } from "../city/extension";
import { useBridges } from "./client";
import { BRIDGE_BADGES, useBadges } from "./icons";
import type { Bridge } from "./types";

const SOON_MS = 60 * 60_000;

/** Label on the map: what the bridge is doing, or how long until it does. */
export function bridgeLabel(b: Bridge, now: number): string {
  if (b.now?.phase === "reported") return "open";
  if (b.now?.phase === "window") return "opening";
  const next = b.upcoming[0];
  return next && next.from - now <= SOON_MS ? fmt.until(next.from, now) : "";
}

/** Dutch movable bridges: open ones pulse in sodium, and an opening within the hour shows a countdown. */
export default function BridgeLayer({ map, report }: MapLayerProps): null {
  const { data, error, loading } = useBridges();
  const ready = useBadges(map, BRIDGE_BADGES);
  const now = useNow(15_000);
  const selected = useProfile((s) => (s.entity?.kind === "bridgeopening" ? s.entity.id : null));
  const bridges = useMemo(() => data?.bridges ?? [], [data]);
  const byCode = useMemo(() => new Map(bridges.map((b) => [b.code, b])), [bridges]);

  const points = useMemo(
    (): GeoJSON.FeatureCollection | null =>
      ready
        ? {
            type: "FeatureCollection",
            features: bridges.map((b) => ({
              type: "Feature",
              properties: { code: b.code, open: b.now !== null, icon: b.now ? "pulse-bridge-open" : "pulse-bridge-idle", label: bridgeLabel(b, now), sel: b.code === selected },
              geometry: { type: "Point", coordinates: [b.lon, b.lat] },
            })),
          }
        : null,
    [ready, bridges, now, selected],
  );

  useGeoJsonLayer(map, {
    id: "pulse-bridges",
    data: points,
    fadeBy: "code",
    clickable: ["pulse-bridges-badge"],
    onClick: (f) => {
      const bridge = byCode.get(String(f.properties.code));
      if (bridge) profile.open({ kind: "bridgeopening", id: bridge.code, data: { bridge } });
    },
    layers: (source) => [
      { id: `${source}-pulse`, type: "circle", source, filter: ["get", "open"], paint: { "circle-radius": 14, "circle-color": MAP_INK.sodium, "circle-opacity": 0.2, "circle-blur": 0.4, "circle-pitch-alignment": "viewport" } },
      { id: `${source}-sel`, type: "circle", source, filter: ["get", "sel"], paint: { "circle-radius": 20, "circle-color": MAP_INK.ice, "circle-opacity": 0.12, "circle-stroke-color": MAP_INK.ice, "circle-stroke-width": 1 } },
      {
        id: `${source}-badge`,
        type: "symbol",
        source,
        layout: { "icon-image": ["get", "icon"], "icon-size": ["interpolate", ["linear"], ["zoom"], 7, 0.55, 12, 0.8, 16, 1], "icon-allow-overlap": true, "icon-ignore-placement": true },
      },
      {
        id: `${source}-label`,
        type: "symbol",
        source,
        layout: { "text-field": ["get", "label"], "text-font": ["Noto Sans Regular"], "text-size": 11, "text-offset": [0, 1.5], "text-anchor": "top", "text-letter-spacing": 0.06, "text-optional": true },
        paint: { "text-color": MAP_INK.sodium, "text-halo-color": MAP_INK.void, "text-halo-width": 1.3 },
      },
    ],
  });

  const open = bridges.filter((b) => b.now).length;

  // The halo of every open bridge breathes together: one animation, no per-feature state. With none open the map idles.
  const pulsing = open > 0;
  useMapPulse(map, "pulse-bridges-pulse", 1800, (phase) => [["circle-radius", 12 + phase * 14], ["circle-opacity", 0.32 * (1 - phase)]], pulsing);

  useEffect(() => {
    report({ loading: loading && !data, error: error?.message ?? null, count: open });
  }, [report, loading, data, error, open]);
  return null;
}
