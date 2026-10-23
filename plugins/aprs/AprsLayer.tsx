import { useEffect, useMemo } from "react";
import { profile } from "../../app/core/profile";
import { MAP_INK, useGeoJsonLayer, useMapView, type MapLayerProps } from "../city/extension";
import { useAprsStations, useAprsStream } from "./client";
import { geographicBox, insideBox } from "./view";

export default function AprsLayer({ map, report }: MapLayerProps): null {
  const view = useMapView(map);
  const status = useAprsStream(view);
  const stations = useAprsStations((s) => s.stations);
  const inView = useMemo(() => [...stations.values()].filter((p) => insideBox(geographicBox(view), p)), [stations, view]);
  const points = useMemo((): GeoJSON.FeatureCollection => ({ type: "FeatureCollection", features: inView.map((p) => ({ type: "Feature", properties: { id: p.id, name: p.name, weather: p.weather !== null }, geometry: { type: "Point", coordinates: [p.lon!, p.lat!] } })) }), [inView]);
  const trails = useMemo((): GeoJSON.FeatureCollection => ({ type: "FeatureCollection", features: inView.filter((p) => p.trail.length > 1).map((p) => ({ type: "Feature", properties: { id: p.id }, geometry: { type: "LineString", coordinates: p.trail } })) }), [inView]);
  useEffect(() => { report({ loading: status.state === "connecting", error: status.state === "error" ? status.message : null, count: inView.length }); }, [report, status, inView.length]);
  useGeoJsonLayer(map, { id: "aprs-trails", data: trails, fadeBy: "id", belowLabels: true, layers: (source) => [{ id: `${source}-line`, type: "line", source, paint: { "line-color": MAP_INK.sodium, "line-width": 1.5, "line-opacity": 0.45 } }] });
  useGeoJsonLayer(map, {
    id: "aprs-stations", data: points, fadeBy: "id", clickable: ["aprs-stations-point", "aprs-stations-label"],
    onClick: (feature) => { const p = stations.get(String(feature.properties.id)); if (p) profile.open({ kind: "aprs", id: p.id, data: p }); },
    layers: (source) => [
      { id: `${source}-point`, type: "circle", source, paint: { "circle-radius": 5, "circle-color": ["case", ["get", "weather"], MAP_INK.mint, MAP_INK.sodium], "circle-stroke-color": MAP_INK.void, "circle-stroke-width": 1.5 } },
      { id: `${source}-label`, type: "symbol", source, layout: { "text-field": ["get", "name"], "text-font": ["Noto Sans Regular"], "text-size": 11, "text-anchor": "top", "text-offset": [0, 0.8] }, paint: { "text-color": MAP_INK.bone, "text-halo-color": MAP_INK.void, "text-halo-width": 1.5 } },
    ],
  });
  return null;
}
