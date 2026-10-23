import type { Map as MapLibreMap } from "maplibre-gl";
import { useMemo } from "react";
import { destination } from "../../shared/geo";
import { MAP_INK, useGeoJsonLayer } from "../city/extension";
import type { Webcam } from "./types";

/** Operators supply a bearing but no FOV or range; these cones illustrate an estimated view. */
const FOV_DEG = 60;
const RANGE_M = 100;

/** Ground geometry keeps the viewing cones aligned when the map turns and tilts. */
export function useCameraDirections(map: MapLibreMap, cameras: readonly Webcam[], id = "webcams-directions"): void {
  const data = useMemo((): GeoJSON.FeatureCollection => ({
    type: "FeatureCollection",
    features: cameras.flatMap((camera): GeoJSON.Feature<GeoJSON.Polygon>[] => {
      if (camera.bearing === null) return [];
      const origin = [camera.lon, camera.lat];
      const ring = [origin];
      for (let step = 0; step <= 10; step++) {
        const point = destination(camera, camera.bearing - FOV_DEG / 2 + FOV_DEG * step / 10, RANGE_M);
        // Keep a cone crossing the date line in the same world copy as its camera.
        const lon = camera.lon + ((point.lon - camera.lon + 540) % 360) - 180;
        ring.push([lon, point.lat]);
      }
      ring.push(origin);
      return [{ type: "Feature", properties: { id: camera.id }, geometry: { type: "Polygon", coordinates: [ring] } }];
    }),
  }), [cameras]);
  useGeoJsonLayer(map, {
    id,
    data,
    fadeBy: "id",
    belowLabels: true,
    layers: (source) => [
      { id: `${source}-fill`, type: "fill", source, minzoom: 13, paint: { "fill-color": MAP_INK.ice, "fill-opacity": 0.14 } },
      { id: `${source}-edge`, type: "line", source, minzoom: 13, paint: { "line-color": MAP_INK.ice, "line-opacity": 0.45, "line-width": 0.8 } },
    ],
  });
}
