import type { ImageSource } from "maplibre-gl";
import { useEffect } from "react";
import { usePoll } from "../../app/core/hooks";
import { addMapLayers, type MapLayerProps } from "../city/extension";
import { auroraRgba, decodeGrid, fetchAuroraGrid, sampleField, type AuroraField } from "./client";

const ID = "spacewx-aurora";
/** Web Mercator stops here; the image covers the whole mapped world. */
const MAX_LAT = 85.0511;
const SIZE = 720;
const COORDINATES: [[number, number], [number, number], [number, number], [number, number]] = [
  [-180, MAX_LAT],
  [180, MAX_LAT],
  [180, -MAX_LAT],
  [-180, -MAX_LAT],
];

/**
 * Paint the probability grid as an image in Web Mercator space, so rows line up with the map.
 * Every pixel is interpolated from the four nearest grid cells, which gives a smooth field rather than blocks.
 */
function render(field: AuroraField): string {
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  const image = ctx.createImageData(SIZE, SIZE);
  for (let j = 0; j < SIZE; j++) {
    const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (j + 0.5)) / SIZE))) * 180) / Math.PI;
    for (let i = 0; i < SIZE; i++) {
      const lon = -180 + (360 * (i + 0.5)) / SIZE;
      const [r, g, b, a] = auroraRgba(sampleField(field, lat, lon));
      const k = (j * SIZE + i) * 4;
      image.data[k] = r;
      image.data[k + 1] = g;
      image.data[k + 2] = b;
      image.data[k + 3] = a;
    }
  }
  ctx.putImageData(image, 0, 0);
  return canvas.toDataURL("image/png");
}

/** The aurora oval as a soft glow over the map, from NOAA's OVATION nowcast, refreshed every ten minutes. */
export default function AuroraLayer({ map, report }: MapLayerProps): null {
  const { data, error, loading } = usePoll((signal) => fetchAuroraGrid(signal), 10 * 60_000, []);

  useEffect(() => report({ loading: loading && !data, error: error?.message ?? null, count: null }), [report, data, error, loading]);

  useEffect(() => {
    if (!data) return;
    const url = render(decodeGrid(data));
    const existing = map.getSource(ID) as ImageSource | undefined;
    if (existing) {
      existing.updateImage({ url, coordinates: COORDINATES });
      return;
    }
    map.addSource(ID, { type: "image", url, coordinates: COORDINATES });
    addMapLayers(map, [{ id: ID, type: "raster", source: ID, paint: { "raster-opacity": 0.95, "raster-fade-duration": 400, "raster-resampling": "linear" } }], true);
  }, [map, data]);

  useEffect(
    () => () => {
      // The map may already be torn down when the City screen unmounts.
      if (!map.style) return;
      if (map.getLayer(ID)) map.removeLayer(ID);
      if (map.getSource(ID)) map.removeSource(ID);
    },
    [map],
  );

  return null;
}
