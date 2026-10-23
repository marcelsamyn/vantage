/**
 * Public surface of the City plugin: the `mapLayers` and `mapLayerGroups` extension points and helpers for layer authors.
 *
 * Any plugin adds a layer to the City map by contributing:
 *
 *   mapLayers: [{ id: "bikes.stations", title: "Bike share", group: "live", swatch: MAP_INK.mint,
 *                 description: "…", view: () => import("./BikeLayer") }]
 *
 * The layer view is a React component that receives the MapLibre map and draws with the helpers below.
 * City mounts it when the user turns the layer on (and the map is zoomed in past `minZoom`),
 * and unmounts it when turned off, so a layer only fetches data while visible.
 *
 * City declares the common groups: live, hazards, weather, street-grid, services, knowledge and network.
 * A plugin with a family of layers of its own declares its group next to them:
 *
 *   mapLayerGroups: [{ id: "reach", title: "Reach", order: 70 }]
 *
 * A plugin that needs a small floating control on the map, such as a time slider, contributes a `mapControls` entry.
 * City mounts it for as long as the map exists, inside the dock above the status line.
 */
import type { Map as MapLibreMap } from "maplibre-gl";
import type { PlacedItem } from "../../app/core/nearby";
import type { Lazy } from "../../app/core/plugin";

export interface LayerStatus {
  loading: boolean;
  error: string | null;
  /** How many things the layer shows right now; null when counting makes no sense. */
  count: number | null;
}

export interface MapLayerProps {
  map: MapLibreMap;
  /** Tell the layer panel what the layer is doing. Partial updates merge. */
  report: (status: Partial<LayerStatus>) => void;
  /**
   * True once, the first time it is called after the viewer switches this layer on. A layer whose data lies far
   * away may then move the camera to it. A layer restored from a saved choice on load, or mounted again by a zoom,
   * gets false, so it never moves the map on its own.
   */
  claimFraming: () => boolean;
}

export interface MapLayerContribution {
  /** Unique; prefix with your plugin id, e.g. "aircraft.live". */
  id: string;
  title: string;
  /** Id of a declared `mapLayerGroups` entry. A layer in an undeclared group appears under "Other". */
  group: string;
  /** One sentence for the layer panel: what this shows and where the data comes from. */
  description: string;
  /** Colour of the layer's swatch. Use MAP_INK values so the panel matches the map. */
  swatch: string;
  defaultOn?: boolean;
  /** The layer is mounted only at or above this zoom. */
  minZoom?: number;
  /** Credit shown on the map while the layer is on. */
  attribution?: string;
  /** A `group` of the plugin's settings that styles this layer. The layer panel links to it. */
  settings?: string;
  view: Lazy<MapLayerProps>;
}

/** A provider can reuse its map renderer for nearby markers. City still draws its off-screen pips. */
export interface NearbyMapLayerContribution {
  source: string;
  view: Lazy<NearbyMapLayerProps>;
}

export interface NearbyMapLayerProps {
  map: MapLibreMap;
  items: readonly PlacedItem[];
  selected: string | null;
  choose: (item: PlacedItem) => void;
}

/** A heading in the layer panel. Layers name it in their `group`. */
export interface MapLayerGroupContribution {
  /** A short lowercase word, e.g. "live". */
  id: string;
  title: string;
  /** Lower comes first. City's groups use 10–80 in steps of 10. */
  order?: number;
}

/** "map": the layers you chose. "around": what is near you, following you as you walk. */
export type MapMode = "map" | "around";

/**
 * A floating control on the City map. The view receives the MapLibre map and the map's mode, and renders its own
 * panel; the dock leaves pointer events to the control, so everything outside the panel still pans the map.
 */
export interface MapControlContribution {
  /** Unique; prefix with your plugin id. */
  id: string;
  /** Names the control in error messages. */
  title: string;
  /** Lower comes first (50 when unset). */
  order?: number;
  view: Lazy<MapControlProps>;
}

export interface MapControlProps {
  map: MapLibreMap;
  mode: MapMode;
}

declare module "../../app/core/plugin" {
  interface Contributions {
    mapLayers?: MapLayerContribution[];
    nearbyMapLayers?: NearbyMapLayerContribution[];
    mapLayerGroups?: MapLayerGroupContribution[];
    mapControls?: MapControlContribution[];
  }
}

export { MAP_INK, useMapView, useGeoJsonLayer, useMapIcon, useMapIcons, ringIcon, useMapPulse, useDomMarkers, emptyCollection, type MapView, type MapIconEntry, type GeoJsonLayerOptions, type DomMarker } from "./layer-kit";

export { addMapLayers } from "./layer-order";
