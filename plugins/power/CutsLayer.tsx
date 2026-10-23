import { ZapOff } from "lucide-react";
import type { ExpressionSpecification } from "maplibre-gl";
import { useEffect, useMemo } from "react";
import { usePoll, usePrefersReducedMotion } from "../../app/core/hooks";
import { profile, useProfile } from "../../app/core/profile";
import { distanceM } from "../../shared/geo";
import { MAP_INK, ringIcon, useGeoJsonLayer, useMapIcon, type MapLayerProps } from "../city/extension";
import { fetchCuts } from "./client";
import type { PowerCuts } from "./types";

/** The feed covers the Amsterdam region only, so the first time the layer opens far away it brings that area into view. */
const AMSTERDAM = { lat: 52.37, lon: 4.9 };

const stateOf = (cut: PowerCuts["cuts"][number]): "fixed" | "fault" | "planned" => (cut.status === "fixed" ? "fixed" : cut.type);

function draw(data: PowerCuts, selected: string | null): { areas: GeoJSON.FeatureCollection; centres: GeoJSON.FeatureCollection } {
  const state = new Map(data.cuts.map((c) => [c.id, stateOf(c)]));
  return {
    areas: {
      type: "FeatureCollection",
      features: data.areas.features.map((f) => {
        const id = String(f.properties?.id ?? "");
        return { ...f, properties: { id, state: state.get(id) ?? "fixed", selected: id === selected } };
      }),
    },
    // A cut is a few streets wide: a dot keeps it findable when the map is zoomed out.
    centres: {
      type: "FeatureCollection",
      features: data.cuts.map((c) => ({ type: "Feature", properties: { id: c.id, state: stateOf(c), selected: c.id === selected }, geometry: { type: "Point", coordinates: [c.lon, c.lat] } })),
    },
  };
}

const COLOUR: ExpressionSpecification = ["match", ["get", "state"], "fault", MAP_INK.alarm, "planned", MAP_INK.sodium, MAP_INK.fog];

/** Today's power cuts on the Liander grid around Amsterdam: the affected streets as shaded areas, red for faults, amber for planned work, grey once fixed. */
export default function CutsLayer({ map, report, claimFraming }: MapLayerProps): null {
  const { data, error } = usePoll((signal) => fetchCuts(signal), 60_000, []);
  const selected = useProfile((s) => (s.entity?.kind === "powercut" ? s.entity.id : null));
  const icon = useMapIcon(map, "power-cut", ZapOff);
  const reduced = usePrefersReducedMotion();
  const drawn = useMemo(() => (data ? draw(data, selected) : null), [data, selected]);

  useEffect(() => {
    report({ loading: !data && !error, error: data ? null : (error?.message ?? null), count: data ? data.cuts.filter((c) => c.status !== "fixed").length : null });
  }, [report, data, error]);

  useEffect(() => {
    if (!data || data.cuts.length === 0 || !claimFraming()) return;
    const c = map.getCenter();
    if (distanceM({ lat: c.lat, lon: c.lng }, AMSTERDAM) < 60_000) return;
    const lons = data.cuts.map((x) => x.lon);
    const lats = data.cuts.map((x) => x.lat);
    map.fitBounds(
      [
        [Math.min(...lons), Math.min(...lats)],
        [Math.max(...lons), Math.max(...lats)],
      ],
      { padding: 90, duration: reduced ? 0 : 1400, maxZoom: 12.5 },
    );
  }, [map, data, reduced, claimFraming]);

  const open = (id: string): void => {
    const cut = data?.cuts.find((c) => c.id === id);
    if (cut) profile.open({ kind: "powercut", id: cut.id, data: cut });
  };

  useGeoJsonLayer(map, {
    id: "power-cuts-area",
    data: drawn?.areas ?? null,
    belowLabels: true,
    clickable: ["power-cuts-area-fill"],
    onClick: (f) => open(String(f.properties.id)),
    layers: (source) => [
      { id: `${source}-fill`, type: "fill", source, paint: { "fill-color": COLOUR, "fill-opacity": ["case", ["get", "selected"], 0.55, ["==", ["get", "state"], "fixed"], 0.12, 0.36] } },
      { id: `${source}-line`, type: "line", source, paint: { "line-color": ["case", ["get", "selected"], MAP_INK.ice, COLOUR], "line-width": ["case", ["get", "selected"], 2.5, 1.2], "line-opacity": 0.9 } },
    ],
  });

  useGeoJsonLayer(map, {
    id: "power-cuts-dot",
    data: icon ? (drawn?.centres ?? null) : null,
    fadeBy: "id",
    clickable: ["power-cuts-dot-ring"],
    onClick: (f) => open(String(f.properties.id)),
    layers: (source) => [
      // A cut that is still on gets a halo, so the few open ones stand out from the many fixed ones.
      {
        id: `${source}-halo`,
        type: "circle",
        source,
        filter: ["!=", ["get", "state"], "fixed"],
        paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 8, 16, 14, 22], "circle-color": COLOUR, "circle-opacity": 0.18, "circle-stroke-color": COLOUR, "circle-stroke-width": 1, "circle-stroke-opacity": 0.5 },
      },
      {
        id: `${source}-ring`,
        type: "circle",
        source,
        paint: {
          "circle-radius": ["case", ["==", ["get", "state"], "fixed"], 3.5, 8.5],
          "circle-color": MAP_INK.void,
          "circle-stroke-color": ["case", ["get", "selected"], MAP_INK.ice, COLOUR],
          "circle-stroke-width": 2,
          "circle-opacity": 0.9,
        },
      },
      ringIcon(source, { icon: "power-cut", color: ["case", ["get", "selected"], MAP_INK.ice, COLOUR], px: 11, filter: ["!=", ["get", "state"], "fixed"] }),
    ],
  });

  return null;
}
