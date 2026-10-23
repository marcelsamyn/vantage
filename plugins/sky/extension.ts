/**
 * Public surface of the Sky plugin: the `skyLayers` and `skyPanels` extension points.
 *
 * A sky layer reports things above you as azimuth/elevation targets; the Sky radar draws them.
 * The layer view is a headless React component: it fetches or computes positions with its own hooks
 * and calls `report(targets)` whenever they change (typically once a second).
 */
import type { Entity, Lazy } from "../../app/core/plugin";
import type { LatLon } from "../../shared/geo";

export { projectSight } from "./sight-projection";

export type SkyShape = "plane" | "dot" | "diamond" | "ring" | "sun" | "moon";
export type SkyTone = "ice" | "sodium" | "alarm" | "mint" | "bone";

export interface SkyTarget {
  /** Unique across all layers, e.g. "aircraft:4ca4f2". */
  id: string;
  label: string;
  /** Second line in the radar tooltip and list, e.g. "37,000 ft · 42 km". */
  detail?: string;
  /** Degrees clockwise from true north. */
  az: number;
  /** Degrees above the horizon; negative is below it. */
  el: number;
  shape: SkyShape;
  tone: SkyTone;
  /** Direction of travel across the ground, for plane glyphs. */
  headingDeg?: number;
  /** 0–1, how much to emphasise the target (e.g. closeness). */
  weight?: number;
  /** Recent or upcoming path across the sky. */
  path?: { az: number; el: number }[];
  /** Opened in the Profiler when the target is clicked. */
  entity?: Entity;
  /** Scenery such as stars: drawn on the radar, but listed after live objects. */
  background?: boolean;
}

export interface SkyLayerProps {
  observer: LatLon;
  report: (targets: SkyTarget[]) => void;
}

export interface SkyLayerContribution {
  /** Unique; prefix with your plugin id. */
  id: string;
  title: string;
  description: string;
  /** CSS colour for the legend swatch. */
  swatch: string;
  defaultOn?: boolean;
  view: Lazy<SkyLayerProps>;
}

/** A panel in the Sky screen's side column, e.g. upcoming satellite passes. */
export interface SkyPanelContribution {
  id: string;
  title: string;
  /** Lower comes first. */
  order?: number;
  view: Lazy<{ observer: LatLon }>;
}

declare module "../../app/core/plugin" {
  interface Contributions {
    skyLayers?: SkyLayerContribution[];
    skyPanels?: SkyPanelContribution[];
  }
}
