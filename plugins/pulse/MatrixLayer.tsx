import { useEffect, useMemo } from "react";
import { profile, useProfile } from "../../app/core/profile";
import { MAP_INK, useGeoJsonLayer, useMapView, type MapLayerProps } from "../city/extension";
import { useMatrix } from "./client";
import { gantryLook } from "./matrix";

/** Lane signs over Dutch motorways that show something now: speed limits, closed lanes, merges. */
export default function MatrixLayer({ map, report }: MapLayerProps): null {
  const view = useMapView(map);
  const { data, error, loading } = useMatrix(view);
  const selected = useProfile((s) => (s.entity?.kind === "matrixgantry" ? s.entity.id : null));
  const gantries = useMemo(() => data?.gantries ?? [], [data]);
  const byId = useMemo(() => new Map(gantries.map((g) => [g.id, g])), [gantries]);

  const points = useMemo(
    (): GeoJSON.FeatureCollection => ({
      type: "FeatureCollection",
      features: gantries.map((g) => {
        const look = gantryLook(g);
        return { type: "Feature", properties: { id: g.id, label: look.label, ink: look.ink, sel: g.id === selected }, geometry: { type: "Point", coordinates: [g.lon, g.lat] } };
      }),
    }),
    [gantries, selected],
  );

  useGeoJsonLayer(map, {
    id: "pulse-matrix",
    data: points,
    fadeBy: "id",
    clickable: ["pulse-matrix-disc"],
    onClick: (f) => {
      const gantry = byId.get(String(f.properties.id));
      if (gantry) profile.open({ kind: "matrixgantry", id: gantry.id, data: { gantry } });
    },
    layers: (source) => [
      { id: `${source}-sel`, type: "circle", source, filter: ["get", "sel"], paint: { "circle-radius": 19, "circle-color": MAP_INK.ice, "circle-opacity": 0.12, "circle-stroke-color": MAP_INK.ice, "circle-stroke-width": 1 } },
      {
        id: `${source}-disc`,
        type: "circle",
        source,
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 8, 7, 12, 11, 16, 14],
          "circle-color": MAP_INK.void,
          "circle-opacity": 0.92,
          "circle-stroke-color": ["get", "ink"],
          "circle-stroke-width": 2,
        },
      },
      {
        id: `${source}-label`,
        type: "symbol",
        source,
        layout: { "text-field": ["get", "label"], "text-font": ["Noto Sans Regular"], "text-size": ["interpolate", ["linear"], ["zoom"], 8, 8, 14, 11], "text-allow-overlap": true, "text-ignore-placement": true },
        paint: { "text-color": ["get", "ink"] },
      },
    ],
  });

  useEffect(() => {
    report({ loading: loading && !data, error: error?.message ?? null, count: data?.total ?? null });
  }, [report, loading, data, error]);
  return null;
}
