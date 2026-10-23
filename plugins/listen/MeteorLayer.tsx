import type { ExpressionSpecification } from "maplibre-gl";
import { useEffect, useMemo } from "react";
import { useGeoJsonLayer, type MapLayerProps } from "../city/extension";
import { openMeteor, useMeteors } from "./client";
import { HEIGHT_STOPS } from "./meteor-facts";
import type { Meteor } from "./types";

/** Colour by the height where the meteor lit up: low and warm, high and cold. */
const BY_HEIGHT: ExpressionSpecification = ["interpolate", ["linear"], ["get", "h"], ...HEIGHT_STOPS.flatMap(([km, colour]) => [km, colour])];

/** Each meteor is a glowing point where it lit up and a thin line to where it burned out. */
function toFeatures(meteors: readonly Meteor[]): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  for (const m of meteors) {
    const properties = { id: m.id, h: m.begin.heightKm };
    features.push({ type: "Feature", properties, geometry: { type: "Point", coordinates: [m.begin.lon, m.begin.lat] } });
    features.push({
      type: "Feature",
      properties,
      geometry: {
        type: "LineString",
        coordinates: [
          [m.begin.lon, m.begin.lat],
          [m.end.lon, m.end.lat],
        ],
      },
    });
  }
  return { type: "FeatureCollection", features };
}

/** City map layer: every meteor in the latest Global Meteor Network file, worldwide. */
export default function MeteorLayer({ map, report }: MapLayerProps): null {
  const { data, loading, error } = useMeteors("world");
  const byId = useMemo(() => new Map((data?.meteors ?? []).map((m) => [m.id, m])), [data]);
  const geojson = useMemo(() => (data ? toFeatures(data.meteors) : null), [data]);
  useEffect(() => report({ loading: loading && !data, error: error && !data ? error.message : null, count: data?.meteors.length ?? null }), [report, loading, error, data]);

  useGeoJsonLayer(map, {
    id: "listen-meteors",
    data: geojson,
    clickable: ["listen-meteors-point", "listen-meteors-line"],
    onClick: (f) => {
      const meteor = byId.get(String(f.properties.id));
      if (meteor) openMeteor(meteor);
    },
    layers: (source) => [
      {
        id: `${source}-line`,
        type: "line",
        source,
        filter: ["==", ["geometry-type"], "LineString"],
        layout: { "line-cap": "round" },
        paint: { "line-color": BY_HEIGHT, "line-width": ["interpolate", ["linear"], ["zoom"], 3, 0.8, 9, 2, 14, 4], "line-opacity": 0.9 },
      },
      {
        id: `${source}-glow`,
        type: "circle",
        source,
        filter: ["==", ["geometry-type"], "Point"],
        paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 2, 3, 8, 7, 14, 12], "circle-color": BY_HEIGHT, "circle-opacity": 0.14, "circle-blur": 0.8 },
      },
      {
        id: `${source}-point`,
        type: "circle",
        source,
        filter: ["==", ["geometry-type"], "Point"],
        paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 2, 1.2, 8, 2.4, 14, 4], "circle-color": BY_HEIGHT, "circle-opacity": 0.95 },
      },
    ],
  });
  return null;
}
