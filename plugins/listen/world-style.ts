import type { LayerSpecification, StyleSpecification } from "maplibre-gl";
import { MAP_INK } from "../city/extension";

/**
 * A quiet world plane for the listening map: land, sea, borders and place names, nothing else.
 * It starts from OpenFreeMap's dark vector style and keeps only the layers that read at world scale.
 */

const STYLE_URL = "https://tiles.openfreemap.org/styles/dark";

const LABEL = { "text-color": "#56616d", "text-halo-color": "rgba(5,7,10,0.92)", "text-halo-width": 1.3, "text-halo-blur": 0.4 };

/** Layers to keep, with the paint that turns each into part of a night-time chart. */
const KEEP: Readonly<Record<string, Record<string, unknown>>> = {
  background: { "background-color": "#111c27" },
  water: { "fill-color": "#04070b" },
  landcover_ice_shelf: { "fill-color": "#18242f" },
  landcover_glacier: { "fill-color": "#18242f" },
  "boundary_country_z0-4": { "line-color": "#33465a", "line-opacity": 0.9 },
  "boundary_country_z5-": { "line-color": "#33465a", "line-opacity": 0.9 },
  water_name: { "text-color": "#2e4a5e", "text-halo-color": MAP_INK.void },
  place_country_major: LABEL,
  place_country_minor: LABEL,
  place_country_other: LABEL,
  place_city_large: LABEL,
  place_city: LABEL,
};

export async function loadWorldStyle(): Promise<StyleSpecification> {
  const res = await fetch(STYLE_URL);
  if (!res.ok) throw new Error(`Map style unavailable (HTTP ${res.status}). Check your internet connection.`);
  const style = (await res.json()) as StyleSpecification;
  const layers: LayerSpecification[] = [];
  for (const layer of style.layers) {
    const paint = KEEP[layer.id];
    if (!paint) continue;
    layer.paint = { ...layer.paint, ...paint } as typeof layer.paint;
    if (layer.type === "symbol") layer.layout = { ...layer.layout, "text-transform": "uppercase", "text-letter-spacing": 0.14 };
    layers.push(layer);
  }
  return { ...style, layers };
}
