import { useEffect, useMemo } from "react";
import { useMotionNow, usePrefersReducedMotion } from "../../app/core/hooks";
import { MAP_INK, useGeoJsonLayer, type MapLayerProps } from "../city/extension";
import { openHost } from "./actions";
import { useConnections, useOrigin } from "./client";
import { along, greatCircle, withWorldCopy, type Position } from "./geo";
import { organisation } from "./model";
import type { WireHost } from "./types";

interface Place {
  lat: number;
  lon: number;
  connections: number;
  label: string;
  top: WireHost;
  line: Position[];
}

/** Hosts that sit at the same coordinates (one data centre) are drawn as one endpoint. */
function places(hosts: readonly WireHost[], origin: { lat: number; lon: number }): Place[] {
  const byPlace = new Map<string, Place>();
  for (const host of hosts) {
    if (host.scope !== "public" || !host.geo) continue;
    const key = `${host.geo.lat.toFixed(2)},${host.geo.lon.toFixed(2)}`;
    const place = byPlace.get(key);
    if (place) {
      place.connections += host.connections;
      if (host.connections > place.top.connections) {
        place.top = host;
        place.label = organisation(host).label;
      }
    } else {
      byPlace.set(key, { lat: host.geo.lat, lon: host.geo.lon, connections: host.connections, label: organisation(host).label, top: host, line: greatCircle(origin, host.geo) });
    }
  }
  return [...byPlace.values()];
}

const PULSE_MS = 4500;
const FRAME_MS = 90;

/** Arcs from you to every server your Mac talks to, with a packet sliding along each. */
export default function ConnectionsLayer({ map, report }: MapLayerProps): null {
  const poll = useConnections(8000);
  const origin = useOrigin();
  const reduced = usePrefersReducedMotion();
  const spots = useMemo(() => (poll.data && origin ? places(poll.data.hosts, origin) : []), [poll.data, origin]);
  // The packets are ambient: they slide while someone watches and hold still at rest.
  const now = useMotionNow(spots.length > 0 && !reduced ? FRAME_MS : null);

  useEffect(() => {
    report({ loading: poll.loading && !poll.data, error: poll.error?.message ?? null, count: poll.data ? spots.length : null });
  }, [report, poll.loading, poll.data, poll.error, spots.length]);

  const arcs = useMemo(
    (): GeoJSON.FeatureCollection => ({
      type: "FeatureCollection",
      features: spots.flatMap((s) => withWorldCopy(s.line).map((coordinates): GeoJSON.Feature => ({ type: "Feature", properties: { n: s.connections }, geometry: { type: "LineString", coordinates } }))),
    }),
    [spots],
  );

  const endpoints = useMemo(
    (): GeoJSON.FeatureCollection => ({
      type: "FeatureCollection",
      features: [
        ...spots.map((s): GeoJSON.Feature => ({ type: "Feature", properties: { kind: "remote", n: s.connections, label: `${s.label} · ${s.connections}`, ip: s.top.ip }, geometry: { type: "Point", coordinates: [s.lon, s.lat] } })),
        ...(origin ? [{ type: "Feature", properties: { kind: "self", n: 1, label: "This Mac", ip: "" }, geometry: { type: "Point", coordinates: [origin.lon, origin.lat] } } satisfies GeoJSON.Feature] : []),
      ],
    }),
    [spots, origin],
  );

  const packets = useMemo(
    (): GeoJSON.FeatureCollection => ({
      type: "FeatureCollection",
      features: reduced
        ? []
        : spots.flatMap((s, i) => {
            const phase = (((now + i * 611) % PULSE_MS) / PULSE_MS) ** 1.4;
            const at = along(s.line, phase);
            return withWorldCopy([at]).map((c): GeoJSON.Feature => ({ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: c[0] ?? at } }));
          }),
    }),
    [spots, now, reduced],
  );

  useGeoJsonLayer(map, {
    id: "wire-arcs",
    data: arcs,
    belowLabels: true,
    layers: (source) => [
      { id: `${source}-glow`, type: "line", source, layout: { "line-cap": "round" }, paint: { "line-color": MAP_INK.sodium, "line-width": 8, "line-opacity": 0.09, "line-blur": 4 } },
      {
        id: `${source}-line`,
        type: "line",
        source,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": MAP_INK.sodium, "line-width": ["interpolate", ["linear"], ["sqrt", ["get", "n"]], 1, 1.3, 6, 3], "line-opacity": 0.7 },
      },
    ],
  });

  useGeoJsonLayer(map, {
    id: "wire-endpoints",
    data: endpoints,
    clickable: ["wire-endpoints-core"],
    onClick: (feature) => {
      const host = poll.data?.hosts.find((h) => h.ip === String(feature.properties.ip));
      if (host) openHost(host);
    },
    layers: (source) => [
      {
        id: `${source}-halo`,
        type: "circle",
        source,
        filter: ["==", ["get", "kind"], "remote"],
        paint: { "circle-radius": ["+", 9, ["*", 2.6, ["sqrt", ["get", "n"]]]], "circle-color": MAP_INK.sodium, "circle-opacity": 0.14, "circle-blur": 0.8, "circle-stroke-color": MAP_INK.sodium, "circle-stroke-width": 1, "circle-stroke-opacity": 0.35 },
      },
      {
        id: `${source}-core`,
        type: "circle",
        source,
        paint: {
          "circle-radius": ["case", ["==", ["get", "kind"], "self"], 6, ["+", 3.5, ["*", 0.9, ["sqrt", ["get", "n"]]]]],
          "circle-color": MAP_INK.void,
          "circle-stroke-color": ["case", ["==", ["get", "kind"], "self"], MAP_INK.ice, MAP_INK.sodium],
          "circle-stroke-width": 2,
        },
      },
      {
        id: `${source}-label`,
        type: "symbol",
        source,
        layout: { "text-field": ["get", "label"], "text-font": ["Noto Sans Regular"], "text-size": 11, "text-offset": [0, 1.3], "text-anchor": "top", "text-letter-spacing": 0.06, "text-optional": true },
        paint: { "text-color": ["case", ["==", ["get", "kind"], "self"], MAP_INK.ice, MAP_INK.bone], "text-halo-color": MAP_INK.void, "text-halo-width": 1.4 },
      },
    ],
  });

  useGeoJsonLayer(map, {
    id: "wire-packets",
    data: packets,
    layers: (source) => [
      { id: `${source}-glow`, type: "circle", source, paint: { "circle-radius": 6, "circle-color": MAP_INK.sodium, "circle-opacity": 0.28, "circle-blur": 0.7 } },
      { id: `${source}-core`, type: "circle", source, paint: { "circle-radius": 2, "circle-color": MAP_INK.bone } },
    ],
  });

  return null;
}
