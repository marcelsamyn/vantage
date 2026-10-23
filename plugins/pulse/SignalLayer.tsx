import type { GeoJSONSource } from "maplibre-gl";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { useAmbientMotion, usePrefersReducedMotion } from "../../app/core/hooks";
import { profile, useProfile } from "../../app/core/profile";
import { MAP_INK, useGeoJsonLayer, useMapView, type MapLayerProps } from "../city/extension";
import { ROUTE_ZOOM, useSignalHeads, useSignalStream } from "./client";
import { STATE_COLOR, lookOf } from "./signals";
import type { SignalStreamEvent } from "./types";

const HEADS = "pulse-signal-heads";
const ROUTES = "pulse-signal-routes";
const FLASH = "pulse-signal-flash";
const FLASH_MS = 800;
/** Only a change that just happened earns a ripple; the opening snapshot does not. */
const FRESH_MS = 5_000;

const BLINK_OPACITY = ["case", ["==", ["coalesce", ["feature-state", "b"], true], false], 0.25, 1];
const LIT = ["match", ["coalesce", ["feature-state", "s"], 9], [1, 2, 3, 4, 5, 6], true, false];
const PEDESTRIAN = ["==", ["get", "lane"], "pedestrian"];

const radius = (ped: number, other: number): unknown[] => ["case", PEDESTRIAN, ped, other];

/** Live traffic lights: every signal head in view, coloured by the state Hamburg reports right now. */
export default function SignalLayer({ map, report }: MapLayerProps): null {
  const view = useMapView(map);
  const reduced = usePrefersReducedMotion();
  const ambient = useAmbientMotion();
  const { data, error, loading } = useSignalHeads(view);
  const heads = useMemo(() => data?.heads ?? [], [data]);
  const selectedId = useProfile((s) => (s.entity?.kind === "signalhead" ? Number(s.entity.id) : null));

  const ids = useMemo(() => heads.map((h) => h.id), [heads]);
  const byId = useMemo(() => new Map(heads.map((h) => [h.id, h])), [heads]);
  const states = useRef(new Map<number, number>());
  const flashing = useRef(new Set<number>());
  const flashes = useRef(new Map<number, { t0: number; color: string }>());
  const raf = useRef(0);
  const byIdRef = useRef(byId);
  byIdRef.current = byId;

  const points = useMemo(
    (): GeoJSON.FeatureCollection => ({
      type: "FeatureCollection",
      features: heads.map((h) => ({ type: "Feature", properties: { id: h.id, lane: h.lane, sel: h.id === selectedId }, geometry: { type: "Point", coordinates: [h.lon, h.lat] } })),
    }),
    [heads, selectedId],
  );
  const lines = useMemo(
    (): GeoJSON.FeatureCollection => ({
      type: "FeatureCollection",
      features: heads.filter((h) => h.route).map((h) => ({ type: "Feature", properties: { id: h.id, lane: h.lane }, geometry: { type: "LineString", coordinates: h.route ?? [] } })),
    }),
    [heads],
  );

  useGeoJsonLayer(map, {
    id: ROUTES,
    data: lines,
    promoteId: "id",
    belowLabels: true,
    layers: (source) => [
      { id: `${source}-casing`, type: "line", source, minzoom: ROUTE_ZOOM, layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": MAP_INK.void, "line-width": ["interpolate", ["linear"], ["zoom"], 16.4, 3.5, 19, 9], "line-opacity": 0.55 } },
      {
        id: `${source}-line`,
        type: "line",
        source,
        minzoom: ROUTE_ZOOM,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": STATE_COLOR as never,
          "line-width": ["interpolate", ["linear"], ["zoom"], 16.4, 1.8, 19, 5],
          "line-opacity": ["*", ["case", LIT, 0.78, 0.2], BLINK_OPACITY] as never,
        },
      },
    ],
  });

  useGeoJsonLayer(map, {
    id: HEADS,
    data: points,
    promoteId: "id",
    clickable: [`${HEADS}-dot`],
    onClick: (f) => {
      const head = byIdRef.current.get(Number(f.properties.id));
      if (head) profile.open({ kind: "signalhead", id: String(head.id), data: { head } });
    },
    layers: (source) => [
      {
        id: `${source}-halo`,
        type: "circle",
        source,
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 15, radius(5, 8), 17, radius(9, 15), 19, radius(14, 22)] as never,
          "circle-color": STATE_COLOR as never,
          "circle-blur": 0.7,
          "circle-opacity": ["*", ["case", LIT, 0.3, 0], BLINK_OPACITY] as never,
        },
      },
      { id: `${source}-sel`, type: "circle", source, filter: ["get", "sel"], paint: { "circle-radius": 17, "circle-color": MAP_INK.ice, "circle-opacity": 0.12, "circle-stroke-color": MAP_INK.ice, "circle-stroke-width": 1.2 } },
      {
        id: `${source}-dot`,
        type: "circle",
        source,
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 15, radius(2.4, 3.6), 17, radius(4, 6.4), 19, radius(6, 9.5)] as never,
          "circle-color": STATE_COLOR as never,
          "circle-opacity": BLINK_OPACITY as never,
          "circle-stroke-color": MAP_INK.void,
          "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 15, 1, 19, 2],
        },
      },
    ],
  });

  useGeoJsonLayer(map, {
    id: FLASH,
    data: null,
    layers: (source) => [{ id: `${source}-ring`, type: "circle", source, paint: { "circle-radius": ["get", "r"], "circle-color": MAP_INK.void, "circle-opacity": 0, "circle-stroke-color": ["get", "c"], "circle-stroke-width": 2, "circle-stroke-opacity": ["get", "o"] } }],
  });

  const paint = useCallback(
    (id: number, code: number): void => {
      const look = lookOf(code);
      for (const source of [HEADS, ROUTES]) map.setFeatureState({ source, id }, { s: code, b: true });
      if (look.flashing) flashing.current.add(id);
      else flashing.current.delete(id);
    },
    [map],
  );

  const ripple = useCallback(
    (now: number): void => {
      const src = map.getSource(FLASH) as GeoJSONSource | undefined;
      if (!src) return;
      const features: GeoJSON.Feature[] = [];
      for (const [id, f] of flashes.current) {
        const t = (now - f.t0) / FLASH_MS;
        const head = byIdRef.current.get(id);
        if (t >= 1 || !head) {
          flashes.current.delete(id);
          continue;
        }
        const eased = 1 - (1 - t) ** 3;
        features.push({ type: "Feature", properties: { r: 6 + eased * 22, o: 0.85 * (1 - t), c: f.color }, geometry: { type: "Point", coordinates: [head.lon, head.lat] } });
      }
      src.setData({ type: "FeatureCollection", features });
      if (flashes.current.size > 0) raf.current = requestAnimationFrame(ripple);
      else raf.current = 0;
    },
    [map],
  );

  const onEvent = useCallback(
    (e: SignalStreamEvent): void => {
      if (e.t !== "state" || typeof e.v !== "number") return;
      const prev = states.current.get(e.id);
      if (prev === e.v) return;
      states.current.set(e.id, e.v);
      paint(e.id, e.v);
      if (reduced || prev === undefined || Date.now() - e.at > FRESH_MS) return;
      flashes.current.set(e.id, { t0: performance.now(), color: lookOf(e.v).ink });
      if (!raf.current) raf.current = requestAnimationFrame(ripple);
    },
    [paint, reduced, ripple],
  );

  const stream = useSignalStream(ids, true, onEvent);

  // A state belongs to a head, so forget the ones that left view and repaint the rest onto the fresh source.
  useEffect(() => {
    const keep = new Set(ids);
    for (const id of [...states.current.keys()]) if (!keep.has(id)) states.current.delete(id);
    for (const id of [...flashing.current]) if (!keep.has(id)) flashing.current.delete(id);
    for (const [id, code] of states.current) paint(id, code);
  }, [ids, paint, points]);

  // Flashing signals blink as an ambient loop; at rest or with reduced motion they stay lit instead of freezing half-dim.
  useEffect(() => {
    if (!ambient) return;
    const setBlink = (on: boolean): void => {
      for (const source of [HEADS, ROUTES]) if (map.getSource(source)) for (const id of flashing.current) map.setFeatureState({ source, id }, { b: on });
    };
    const timer = setInterval(() => setBlink(Math.floor(Date.now() / 500) % 2 === 0), 500);
    return () => {
      clearInterval(timer);
      setBlink(true);
    };
  }, [map, ambient]);

  useEffect(
    () => () => {
      cancelAnimationFrame(raf.current);
      raf.current = 0;
    },
    [],
  );

  useEffect(() => {
    const message = error?.message ?? (stream.state === "error" ? stream.error : null);
    report({ loading: (loading && heads.length === 0) || (stream.state === "connecting" && states.current.size === 0), error: message, count: heads.length });
  }, [report, loading, error, heads.length, stream.state, stream.error]);

  return null;
}

