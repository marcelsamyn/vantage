import { Activity, Flame, Mountain, Sun, Tornado, Waves, type LucideIcon } from "lucide-react";
import type { ExpressionSpecification } from "maplibre-gl";
import { useEffect, useMemo } from "react";
import { usePoll } from "../../app/core/hooks";
import { profile, useProfile } from "../../app/core/profile";
import { MAP_INK, ringIcon, useGeoJsonLayer, useMapIcon, type MapLayerProps } from "../city/extension";
import { fetchDisasters } from "./client";
import type { DisasterType } from "./types";

const TYPE_ICON: Record<DisasterType, LucideIcon> = { EQ: Activity, TC: Tornado, FL: Waves, VO: Mountain, WF: Flame, DR: Sun };
const TYPES = Object.keys(TYPE_ICON) as DisasterType[];
const INK: ExpressionSpecification = ["case", ["get", "selected"], MAP_INK.ice, ["get", "red"], MAP_INK.alarm, MAP_INK.sodium];

/** Orange and red disaster alerts from GDACS: cyclones, floods, eruptions, wildfires, droughts, earthquakes. */
export default function DisasterLayer({ map, report }: MapLayerProps): null {
  const { data, error, loading } = usePoll((signal) => fetchDisasters(signal), 10 * 60_000, []);
  const selected = useProfile((s) => (s.entity?.kind === "disaster" ? s.entity.id : null));
  // The list is fixed, so the hooks run in the same order on every render.
  const icons = TYPES.map((t) => useMapIcon(map, `hazards-disaster-${t}`, TYPE_ICON[t])).every(Boolean);
  useEffect(() => report({ loading: loading && !data, error: error?.message ?? null, count: data?.length ?? null }), [report, data, error, loading]);

  const points = useMemo(
    (): GeoJSON.FeatureCollection | null =>
      data && icons
        ? {
            type: "FeatureCollection",
            features: data.map((d) => ({ type: "Feature", properties: { id: d.id, type: d.type, red: d.alert === "Red", selected: d.id === selected }, geometry: { type: "Point", coordinates: [d.lon, d.lat] } })),
          }
        : null,
    [data, icons, selected],
  );

  useGeoJsonLayer(map, {
    id: "hazards-disasters",
    data: points,
    fadeBy: "id",
    clickable: ["hazards-disasters-ring"],
    onClick: (f) => {
      const d = data?.find((x) => x.id === f.properties.id);
      if (d) profile.open({ kind: "disaster", id: d.id, data: d });
    },
    layers: (source) => [
      {
        id: `${source}-ring`,
        type: "circle",
        source,
        paint: {
          "circle-radius": ["case", ["get", "selected"], 13, 10],
          "circle-color": MAP_INK.void,
          "circle-opacity": 0.85,
          "circle-stroke-color": INK,
          "circle-stroke-width": 2,
        },
      },
      ringIcon(source, { icon: ["concat", "hazards-disaster-", ["get", "type"]], color: INK, px: 13 }),
    ],
  });
  return null;
}
