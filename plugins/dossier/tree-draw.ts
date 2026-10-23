import type { LayerSpecification } from "maplibre-gl";
import { MAP_INK } from "../city/extension";
import type { MapTree } from "./types";

export function treeCollection(trees: readonly MapTree[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: trees.map((t) => ({
      type: "Feature",
      properties: { id: t.id, name: t.name, remarkable: t.remarkable },
      geometry: { type: "Point", coordinates: [t.lon, t.lat] },
    })),
  };
}

/** Remarkable trees: a ring and a label, so they read as landmarks. */
export function remarkableLayers(source: string): LayerSpecification[] {
  return [
    {
      id: `${source}-ring`,
      type: "circle",
      source,
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 12, 3, 16, 7, 19, 11],
        "circle-color": MAP_INK.void,
        "circle-opacity": 0.85,
        "circle-stroke-color": MAP_INK.mint,
        "circle-stroke-width": 1.5,
      },
    },
    {
      id: `${source}-core`,
      type: "circle",
      source,
      paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 12, 1.2, 16, 3, 19, 5], "circle-color": MAP_INK.mint },
    },
    {
      id: `${source}-label`,
      type: "symbol",
      source,
      minzoom: 15,
      layout: { "text-field": ["get", "name"], "text-font": ["Noto Sans Regular"], "text-size": 10.5, "text-offset": [0, 1.3], "text-anchor": "top", "text-max-width": 9, "text-optional": true },
      paint: { "text-color": MAP_INK.mint, "text-halo-color": MAP_INK.void, "text-halo-width": 1.3 },
    },
  ];
}

/** Ordinary street trees: small dots that thin out visually at the edge of the zoom range. */
export function streetTreeLayers(source: string): LayerSpecification[] {
  return [
    {
      id: `${source}-dot`,
      type: "circle",
      source,
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 16, 2.2, 19, 5],
        "circle-color": MAP_INK.mint,
        "circle-opacity": ["case", ["get", "remarkable"], 1, 0.62],
        "circle-stroke-color": MAP_INK.void,
        "circle-stroke-width": 0.8,
      },
    },
    {
      id: `${source}-label`,
      type: "symbol",
      source,
      minzoom: 18,
      layout: { "text-field": ["get", "name"], "text-font": ["Noto Sans Regular"], "text-size": 10, "text-offset": [0, 1], "text-anchor": "top", "text-max-width": 8, "text-optional": true },
      paint: { "text-color": MAP_INK.fog, "text-halo-color": MAP_INK.void, "text-halo-width": 1.2 },
    },
  ];
}
