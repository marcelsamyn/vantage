import { MessageSquareText } from "lucide-react";
import type { ExpressionSpecification } from "maplibre-gl";
import { useEffect, useMemo } from "react";
import { usePoll } from "../../app/core/hooks";
import { profile, useProfile } from "../../app/core/profile";
import { MAP_INK, ringIcon, useGeoJsonLayer, useMapIcon, useMapView, type MapLayerProps } from "../city/extension";
import { fetchNotes } from "./client";

const INK: ExpressionSpecification = ["case", ["get", "selected"], MAP_INK.ice, ["get", "open"], MAP_INK.bone, MAP_INK.ash];

/** OpenStreetMap notes in the visible area: bright marks are open, dim ones were closed within the last week. */
export default function NoteLayer({ map, report }: MapLayerProps): null {
  const view = useMapView(map);
  const key = [view.west, view.south, view.east, view.north].map((v) => v.toFixed(2)).join(",");
  const { data, error, loading } = usePoll((signal) => fetchNotes(view, signal), null, [key]);
  const selected = useProfile((s) => (s.entity?.kind === "mapnote" ? s.entity.id : null));
  const icon = useMapIcon(map, "reach-note", MessageSquareText);
  useEffect(() => report({ loading: loading && !data, error: error?.message ?? null, count: data?.notes.length ?? null }), [report, data, error, loading]);

  const points = useMemo(
    (): GeoJSON.FeatureCollection | null =>
      data && icon
        ? {
            type: "FeatureCollection",
            features: data.notes.map((n) => ({
              type: "Feature",
              properties: { id: String(n.id), open: n.status === "open", selected: String(n.id) === selected },
              geometry: { type: "Point", coordinates: [n.lon, n.lat] },
            })),
          }
        : null,
    [data, icon, selected],
  );

  useGeoJsonLayer(map, {
    id: "reach-notes",
    data: points,
    fadeBy: "id",
    clickable: ["reach-notes-dot"],
    onClick: (f) => {
      const n = data?.notes.find((x) => String(x.id) === f.properties.id);
      if (n) profile.open({ kind: "mapnote", id: String(n.id), data: n });
    },
    layers: (source) => [
      {
        id: `${source}-dot`,
        type: "circle",
        source,
        paint: {
          "circle-radius": ["case", ["get", "selected"], 9, 7.5],
          "circle-color": MAP_INK.void,
          "circle-stroke-color": INK,
          "circle-stroke-width": 1.5,
        },
      },
      ringIcon(source, { icon: "reach-note", color: INK, px: 10 }),
    ],
  });
  return null;
}
