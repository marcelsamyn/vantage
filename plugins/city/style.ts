import type { LayerSpecification, LightSpecification, RasterDEMSourceSpecification, SkySpecification, StyleSpecification } from "maplibre-gl";
import { MAP_INK } from "./layer-kit";
import { labelsAboveGround } from "./layer-order";

const STYLE_URL = "https://tiles.openfreemap.org/styles/dark";

/** Paint overrides that turn OpenFreeMap's dark style into a city at night. */
const PAINT: Record<string, Record<string, unknown>> = {
  background: { "background-color": MAP_INK.void },
  water: { "fill-color": "#061723" },
  waterway: { "line-color": "#0a2232" },
  landcover_wood: { "fill-color": "#08140f" },
  landuse_park: { "fill-color": "#08140f" },
  landuse_residential: { "fill-color": "#0b1016", "fill-opacity": 0.6 },
  "aeroway-area": { "fill-color": "#090c10" },
  "aeroway-runway": { "line-color": "#1a222b" },
  "aeroway-taxiway": { "line-color": "#141a21" },
  "aeroway-runway-casing": { "line-color": "rgba(130,228,255,0.12)" },
  highway_path: { "line-color": "#161e27" },
  highway_minor: { "line-color": "#1b242e" },
  highway_major_casing: { "line-color": "rgba(130,228,255,0.07)" },
  highway_major_inner: { "line-color": "#27323e" },
  highway_major_subtle: { "line-color": "#212b35" },
  highway_motorway_casing: { "line-color": "rgba(130,228,255,0.12)" },
  highway_motorway_inner: { "line-color": "#33414f" },
  highway_motorway_subtle: { "line-color": "#25303b" },
  railway: { "line-color": "#151b22" },
  railway_transit: { "line-color": "#151b22" },
  railway_minor: { "line-color": "#131920" },
  railway_dashline: { "line-color": "#0c1015" },
  railway_transit_dashline: { "line-color": "#0c1015" },
  railway_minor_dashline: { "line-color": "#0c1015" },
  boundary_state: { "line-color": "#26313c" },
  "boundary_country_z0-4": { "line-color": "#2c3844" },
  "boundary_country_z5-": { "line-color": "#2c3844" },
  water_name: { "text-color": "#36586d", "text-halo-color": MAP_INK.void },
  highway_name_other: { "text-color": "#4b5662", "text-halo-color": MAP_INK.void, "text-halo-width": 1.2 },
  highway_name_motorway: { "text-color": "#56616d" },
};

const PLACE_LABEL = { "text-color": "#7f8b97", "text-halo-color": "rgba(5,7,10,0.9)", "text-halo-width": 1.4, "text-halo-blur": 0.5 };

/** The id of the 3D buildings layer. */
export const BUILDINGS_LAYER = "city-buildings-3d";

/** 3D buildings: dark slabs that lighten with height, so the skyline reads at a glance. */
const BUILDINGS: LayerSpecification = {
  id: BUILDINGS_LAYER,
  type: "fill-extrusion",
  source: "openmaptiles",
  "source-layer": "building",
  minzoom: 13,
  paint: {
    "fill-extrusion-color": ["interpolate", ["linear"], ["coalesce", ["get", "render_height"], 6], 0, "#121a22", 30, "#18232e", 100, "#22313f", 250, "#2e4558"],
    "fill-extrusion-height": ["interpolate", ["linear"], ["zoom"], 13, 0, 14.5, ["coalesce", ["get", "render_height"], 6]],
    "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], 0],
    "fill-extrusion-opacity": 0.92,
    "fill-extrusion-vertical-gradient": true,
  },
};

/** A faint ice edge on every shore, so rivers and canals read as lines of the city's plan. */
const WATER_EDGE: LayerSpecification = {
  id: "city-water-edge",
  type: "line",
  source: "openmaptiles",
  "source-layer": "water",
  paint: { "line-color": "rgba(130,228,255,0.16)", "line-width": ["interpolate", ["linear"], ["zoom"], 10, 0.5, 16, 1.2] },
};

/** The elevation source that raises the terrain. */
export const RELIEF_SOURCE = "city-relief";
/** MapLibre draws hill shading better from a source of its own than from the one that raises the terrain. */
const SHADE_SOURCE = "city-relief-shade";
/**
 * Open elevation tiles from Mapterhorn. They cover the world to zoom 12, about 20 m a pixel, which is enough for the
 * hills of a city; deeper views scale those tiles up, so a street view asks for a handful of tiles at most.
 */
const RELIEF: RasterDEMSourceSpecification = { type: "raster-dem", tiles: ["https://tiles.mapterhorn.com/{z}/{x}/{y}.webp"], tileSize: 512, maxzoom: 12, encoding: "terrarium" };
export const RELIEF_ATTRIBUTION = "Terrain: © Mapterhorn";

/** Slopes lit like the buildings, from the top left of the screen: lit faces turn ice, the others fall into shadow. */
const HILLSHADE: LayerSpecification = {
  id: "city-hillshade",
  type: "hillshade",
  source: SHADE_SOURCE,
  paint: {
    "hillshade-method": "igor",
    "hillshade-exaggeration": 0.7,
    "hillshade-illumination-direction": 315,
    "hillshade-shadow-color": "rgba(0,0,0,0.7)",
    "hillshade-highlight-color": "rgba(130,228,255,0.32)",
  },
};

/** Moonlight from the top left of the screen: roofs catch it, and the walls that face you stay in shadow. */
const LIGHT: LightSpecification = { anchor: "viewport", color: "#d4e9ff", intensity: 0.5, position: [1.5, 315, 45] };

/** A night sky with a faint glow over the horizon. With the terrain raised, the far city fades into the same haze. */
const SKY: SkySpecification = {
  "sky-color": MAP_INK.void,
  "horizon-color": "#13283a",
  "fog-color": "#0b1620",
  "sky-horizon-blend": 0.6,
  "horizon-fog-blend": 0.6,
  "fog-ground-blend": 0.6,
  "atmosphere-blend": 0,
};

export async function loadCityStyle(): Promise<StyleSpecification> {
  const res = await fetch(STYLE_URL);
  if (!res.ok) throw new Error(`Map style unavailable (HTTP ${res.status}) — check your internet connection`);
  const style = (await res.json()) as StyleSpecification;

  const layers: LayerSpecification[] = [];
  for (const layer of style.layers) {
    if (layer.id === "building") continue; // replaced by 3D extrusions
    const paint = PAINT[layer.id];
    if (paint) layer.paint = { ...layer.paint, ...paint } as typeof layer.paint;
    // A pattern would cover the colour given here. The style's wood pattern is missing from its sprite anyway, so
    // woods drew nothing and warned on every load.
    if (paint && layer.type === "fill") delete layer.paint?.["fill-pattern"];
    if (layer.type === "symbol" && layer.id.startsWith("place_")) {
      layer.paint = { ...layer.paint, ...PLACE_LABEL };
      layer.layout = { ...layer.layout, "text-transform": "uppercase", "text-letter-spacing": 0.16 };
    }
    if (layer.id === "road_oneway" || layer.id === "road_oneway_opposite") continue;
    // Over the land cover and the water, under the rivers and roads.
    if (layer.id === "waterway") layers.push(HILLSHADE, WATER_EDGE);
    layers.push(layer);
    if (layer.id === "railway_dashline") layers.push(BUILDINGS);
  }
  if (!layers.includes(HILLSHADE)) layers.splice(1, 0, HILLSHADE, WATER_EDGE);
  if (!layers.includes(BUILDINGS)) layers.push(BUILDINGS);
  return { ...style, sources: { ...style.sources, [RELIEF_SOURCE]: RELIEF, [SHADE_SOURCE]: RELIEF }, layers: labelsAboveGround(layers), light: LIGHT, sky: SKY };
}
