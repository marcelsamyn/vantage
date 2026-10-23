import type { ExpressionSpecification, Map as MapLibreMap } from "maplibre-gl";
import { useEffect, useMemo, type ReactElement } from "react";
import { usePoll } from "../../app/core/hooks";
import { profile, useProfile } from "../../app/core/profile";
import {
  DEFAULT_REFRESH_MS,
  forgetThings,
  reportThings,
  thingSources,
  thingTypes,
  useFusedThings,
  type FusedThing,
  type ThingQuery,
  type ThingSourceContribution,
  type ThingTypeContribution,
} from "../../app/core/things";
import { MAP_INK, ringIcon, useGeoJsonLayer, useMapIcons, useMapView, type MapIconEntry, type MapView } from "./layer-kit";
import { useEnabledTypes, useMutedSources } from "./store";
import { thingIconName, thingInk } from "./things-ink";

/**
 * Every switched-on kind of thing, from every source that reports it, as one layer.
 *
 * The sources run here: one for each that serves a switched-on type, is not muted, and is within its zoom. Each
 * publishes what it finds to the kernel (`app/core/things.ts`), which merges the reports that mean the same thing.
 * A thing more than one source found carries a second ring, so you can see where two records agree.
 */

/** The source id and the view, rounded so that nudging the map does not ask every source again. 0.001° is about 110 m. */
function queryKey(view: MapView, types: readonly string[]): string {
  const box = [view.west, view.south, view.east, view.north].map((n) => n.toFixed(3)).join(",");
  return `${box}/${Math.round(view.zoom)}/${types.join(",")}`;
}

/** One source, asked again on its own period while the map shows it. */
function SourceRun({ source, query, restart }: { source: ThingSourceContribution; query: ThingQuery; restart: string }): null {
  const { loading, error } = usePoll(
    async (signal) => {
      const provider = (await source.load()).default;
      await provider(query, (things) => {
        if (!signal.aborted) reportThings(source.id, { things, error: null });
      }, signal);
    },
    source.refreshMs ?? DEFAULT_REFRESH_MS,
    [restart],
  );
  useEffect(() => reportThings(source.id, { loading, error: error?.message ?? null }), [source.id, loading, error]);
  // Switched off, or out of its zoom: its things leave the map with it.
  useEffect(() => () => forgetThings(source.id), [source.id]);
  return null;
}

const SELECTED: ExpressionSpecification = ["get", "selected"];
const INK: ExpressionSpecification = ["case", SELECTED, MAP_INK.ice, ["to-color", ["get", "ink"]]];

function toPoints(things: readonly FusedThing[], byType: Map<string, ThingTypeContribution>, selected: string | null): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: things.flatMap((t) => {
      const type = byType.get(t.type);
      if (!type) return [];
      const variant = t.variant !== null && type.variants?.[t.variant] ? t.variant : null;
      return [
        {
          type: "Feature" as const,
          properties: { key: t.key, icon: thingIconName(t.type, variant), ink: thingInk(type.tone, t.state), fused: t.members.length > 1, selected: t.key === selected },
          geometry: { type: "Point" as const, coordinates: [t.at.lon, t.at.lat] },
        },
      ];
    }),
  };
}

export function ThingsLayer({ map }: { map: MapLibreMap }): ReactElement {
  const view = useMapView(map);
  const enabled = useEnabledTypes();
  const muted = useMutedSources();
  const types = useMemo(() => thingTypes().filter((t) => enabled.has(t.id) && view.zoom >= (t.minZoom ?? 0)), [enabled, view.zoom]);
  const visibleTypes = useMemo(() => new Set(types.map((t) => t.id)), [types]);
  const byType = useMemo(() => new Map(types.map((t) => [t.id, t])), [types]);

  const running = useMemo(
    () => thingSources().filter((s) => !muted.has(s.id) && s.types.some((id) => visibleTypes.has(id)) && view.zoom >= (s.minZoom ?? 0)),
    [muted, visibleTypes, view.zoom],
  );
  // Each source is asked about the types it serves, so it can skip the work for the rest.
  const queries = useMemo(
    () => new Map(running.map((s) => [s.id, { box: { west: view.west, south: view.south, east: view.east, north: view.north }, center: view.center, zoom: view.zoom, types: s.types.filter((id) => visibleTypes.has(id)), now: Date.now() } satisfies ThingQuery])),
    [running, view, visibleTypes],
  );

  const icons = useMemo(
    (): MapIconEntry[] =>
      types.flatMap((t) => [
        { name: thingIconName(t.id), load: t.icon },
        ...Object.entries(t.variants ?? {}).map(([variant, load]) => ({ name: thingIconName(t.id, variant), load })),
      ]),
    [types],
  );
  const ready = useMapIcons(map, icons);

  const things = useFusedThings(visibleTypes);
  const selected = useProfile((s) => (s.entity?.kind === "thing" ? s.entity.id : null));
  const byKey = useMemo(() => new Map(things.map((t) => [t.key, t])), [things]);
  const data = useMemo(() => (ready ? toPoints(things, byType, selected) : null), [ready, things, byType, selected]);

  useGeoJsonLayer(map, {
    id: "city-things",
    data,
    fadeBy: "key",
    clickable: ["city-things-ring"],
    onClick: (f) => {
      const hit = byKey.get(String(f.properties.key));
      if (hit) profile.open({ kind: "thing", id: hit.key, data: hit });
    },
    layers: (source) => [
      {
        id: `${source}-halo`,
        type: "circle",
        source,
        filter: SELECTED,
        paint: { "circle-radius": 19, "circle-color": MAP_INK.ice, "circle-opacity": 0.12, "circle-stroke-color": MAP_INK.ice, "circle-stroke-width": 1 },
      },
      {
        id: `${source}-agreed`,
        type: "circle",
        source,
        filter: ["get", "fused"],
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 12, 5.5, 16, 10, 19, 13],
          "circle-color": "transparent",
          "circle-stroke-color": INK,
          "circle-stroke-width": 1,
          "circle-stroke-opacity": 0.5,
        },
      },
      {
        id: `${source}-ring`,
        type: "circle",
        source,
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 12, 3.5, 16, 7.5, 19, 10],
          "circle-color": MAP_INK.void,
          "circle-opacity": 0.9,
          "circle-stroke-color": INK,
          "circle-stroke-width": ["case", SELECTED, 2.5, 1.5],
        },
      },
      ringIcon(source, { icon: ["get", "icon"], color: INK, px: [[13, 7], [16, 11], [19, 15]], minzoom: 13 }),
    ],
  });

  return (
    <>
      {running.map((source) => {
        const query = queries.get(source.id);
        return query ? <SourceRun key={source.id} source={source} query={query} restart={queryKey(view, query.types)} /> : null;
      })}
    </>
  );
}
