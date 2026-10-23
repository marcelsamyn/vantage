import { TrainTrack } from "lucide-react";
import type { ExpressionSpecification } from "maplibre-gl";
import { useEffect, useMemo } from "react";
import { usePoll } from "../../app/core/hooks";
import { profile, useProfile } from "../../app/core/profile";
import { MAP_INK, ringIcon, useGeoJsonLayer, useMapIcon, type MapLayerProps } from "../city/extension";
import { fetchCrossings, protectionOf } from "./client";
import type { LevelCrossing } from "./types";

const PROTECTION_INK: ExpressionSpecification = ["match", ["get", "protection"], "passive", MAP_INK.alarm, "lights", MAP_INK.sodium, MAP_INK.fog];
const INK: ExpressionSpecification = ["case", ["get", "selected"], MAP_INK.ice, PROTECTION_INK];

/** Below this zoom the crossings are too close together for icons: each ring holds a short bar instead. */
const ICON_ZOOM = 12;

/** The crossings change rarely; polling is what retries a failed first load. */
const CROSSINGS_REFRESH_MS = 10 * 60_000;

function draw(crossings: LevelCrossing[], selected: string | null): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: crossings.map((c) => ({
      type: "Feature",
      properties: { id: c.id, protection: protectionOf(c.kind), selected: c.id === selected },
      geometry: { type: "Point", coordinates: [c.lon, c.lat] },
    })),
  };
}

/** Every level crossing on Infrabel's network. Grey rings have barriers, amber rings only lights, red rings only a sign. */
export default function CrossingsLayer({ map, report }: MapLayerProps): null {
  const { data, error } = usePoll((signal) => fetchCrossings(signal), CROSSINGS_REFRESH_MS, []);
  const selected = useProfile((s) => (s.entity?.kind === "crossing" ? s.entity.id : null));
  const icon = useMapIcon(map, "transit-crossing", TrainTrack);
  const drawn = useMemo(() => (data && icon ? draw(data, selected) : null), [data, icon, selected]);

  useEffect(() => {
    report({ loading: !data && !error, error: data ? null : (error?.message ?? null), count: data?.length ?? null });
  }, [report, data, error]);

  useGeoJsonLayer(map, {
    id: "transit-crossings",
    data: drawn,
    fadeBy: "id",
    clickable: ["transit-crossings-ring"],
    onClick: (f) => {
      const crossing = data?.find((c) => c.id === f.properties.id);
      if (crossing) profile.open({ kind: "crossing", id: crossing.id, data: crossing });
    },
    layers: (source) => [
      {
        id: `${source}-ring`,
        type: "circle",
        source,
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], ICON_ZOOM - 1, ["case", ["get", "selected"], 7, 4.5], ICON_ZOOM + 1, ["case", ["get", "selected"], 9, 7.5]],
          "circle-color": MAP_INK.void,
          "circle-stroke-width": 1.8,
          "circle-stroke-color": INK,
        },
      },
      { id: `${source}-bar`, type: "circle", source, maxzoom: ICON_ZOOM, paint: { "circle-radius": 1.4, "circle-color": PROTECTION_INK } },
      ringIcon(source, { icon: "transit-crossing", color: INK, minzoom: ICON_ZOOM, px: [[ICON_ZOOM, 7], [ICON_ZOOM + 1, 10]] }),
    ],
  });

  return null;
}
