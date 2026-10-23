import { useEffect, useMemo } from "react";
import { usePoll } from "../../app/core/hooks";
import { profile, useProfile } from "../../app/core/profile";
import { MAP_INK, useGeoJsonLayer, useMapView, type MapLayerProps } from "../city/extension";
import { fetchIncidents } from "./client";
import { areaFeatures, overlapsCoverage, SOURCES, viewBox } from "./model";

export default function NswLayer({ map, report }: MapLayerProps): null {
  const view = useMapView(map);
  const box = viewBox(view);
  const key = [box.west, box.south, box.east, box.north].join(",");
  const covered = overlapsCoverage("nsw", box);
  const { data: result, error, loading } = usePoll(async (signal) => ({ key, snapshot: await fetchIncidents("nsw", box, signal) }), SOURCES.nsw.refreshMs, [key], !covered);
  const data = covered && result?.key === key ? result.snapshot : null;
  const selected = useProfile((s) => s.entity?.kind === "incident" ? s.entity.id : null);
  const byId = useMemo(() => new Map((data?.incidents ?? []).map((item) => [item.id, item])), [data]);
  const collection = useMemo(() => areaFeatures(data?.incidents ?? [], selected), [data, selected]);
  useEffect(() => report({ loading: covered && loading && !data, error: error?.message ?? null, count: covered ? data?.incidents.filter((item) => item.areas.length > 0).length ?? null : 0 }), [covered, loading, data, error, report]);
  useGeoJsonLayer(map, {
    id: "incidents-nsw-areas", data: collection, belowLabels: true, clickable: ["incidents-nsw-areas-fill"],
    onClick: (feature) => { const item = byId.get(String(feature.properties.id)); if (item) profile.open({ kind: "incident", id: item.id, data: item }); },
    layers: (source) => [
      { id: `${source}-fill`, type: "fill", source, paint: { "fill-color": ["case", ["get", "alert"], MAP_INK.alarm, MAP_INK.sodium], "fill-opacity": 0.17 } },
      { id: `${source}-line`, type: "line", source, paint: { "line-color": ["case", ["get", "selected"], MAP_INK.ice, ["get", "alert"], MAP_INK.alarm, MAP_INK.sodium], "line-width": ["case", ["get", "selected"], 3, 1.5] } },
    ],
  });
  return null;
}
