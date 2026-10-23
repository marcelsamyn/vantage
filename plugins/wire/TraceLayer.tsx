import { useEffect, useMemo } from "react";
import { MAP_INK, useGeoJsonLayer, type MapLayerProps } from "../city/extension";
import { greatCircle, withWorldCopy } from "./geo";
import { routeStops } from "./model";
import { useTrace } from "./trace-store";

/** The route of the last trace: an arc between each pair of located hops, numbered in order. */
export default function TraceLayer({ map, report }: MapLayerProps): null {
  const origin = useTrace((s) => s.origin);
  const hops = useTrace((s) => s.hops);
  const status = useTrace((s) => s.status);
  const stops = useMemo(() => routeStops(origin, hops), [origin, hops]);

  useEffect(() => {
    const message = status === "idle" ? "Run a trace on the Wire screen first." : stops.length === 0 && status !== "running" ? "The last trace has no located hops to draw." : null;
    report({ loading: status === "running" && stops.length === 0, error: message, count: stops.length || null });
  }, [report, status, stops.length]);

  const path = useMemo((): GeoJSON.FeatureCollection => {
    const points = origin ? [origin, ...stops] : stops;
    return {
      type: "FeatureCollection",
      features: points.slice(1).flatMap((to, i) => {
        const from = points[i];
        return from ? withWorldCopy(greatCircle(from, to)).map((coordinates): GeoJSON.Feature => ({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates } })) : [];
      }),
    };
  }, [origin, stops]);

  const dots = useMemo(
    (): GeoJSON.FeatureCollection => ({
      type: "FeatureCollection",
      features: [
        ...stops.map((s, i): GeoJSON.Feature => ({ type: "Feature", properties: { kind: i === stops.length - 1 && status === "done" ? "end" : "hop", label: s.label, place: s.place }, geometry: { type: "Point", coordinates: [s.lon, s.lat] } })),
        ...(origin ? [{ type: "Feature", properties: { kind: "self", label: "This Mac", place: "" }, geometry: { type: "Point", coordinates: [origin.lon, origin.lat] } } satisfies GeoJSON.Feature] : []),
      ],
    }),
    [stops, origin, status],
  );

  useGeoJsonLayer(map, {
    id: "wire-trace-path",
    data: path,
    belowLabels: true,
    layers: (source) => [
      { id: `${source}-glow`, type: "line", source, layout: { "line-cap": "round" }, paint: { "line-color": MAP_INK.ice, "line-width": 7, "line-opacity": 0.1, "line-blur": 4 } },
      { id: `${source}-line`, type: "line", source, layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": MAP_INK.ice, "line-width": 1.8, "line-opacity": 0.85 } },
    ],
  });

  useGeoJsonLayer(map, {
    id: "wire-trace-hops",
    data: dots,
    layers: (source) => [
      {
        id: `${source}-core`,
        type: "circle",
        source,
        paint: {
          "circle-radius": ["match", ["get", "kind"], "self", 6, "end", 7, 5],
          "circle-color": MAP_INK.void,
          "circle-stroke-color": ["match", ["get", "kind"], "end", MAP_INK.sodium, MAP_INK.ice],
          "circle-stroke-width": 2,
        },
      },
      {
        id: `${source}-label`,
        type: "symbol",
        source,
        layout: { "text-field": ["get", "label"], "text-font": ["Noto Sans Regular"], "text-size": 11, "text-offset": [0, -1.3], "text-anchor": "bottom", "text-allow-overlap": true },
        paint: { "text-color": ["match", ["get", "kind"], "end", MAP_INK.sodium, MAP_INK.ice], "text-halo-color": MAP_INK.void, "text-halo-width": 1.4 },
      },
    ],
  });

  return null;
}
