import type { ThingId } from "../../shared/thing-ids";

/** Payloads served by /api/grid: city infrastructure mapped in OpenStreetMap. */

export const GRID_KINDS = [
  "camera",
  "signal",
  "wifi",
  "tower",
  "substation",
  "powerline",
  "police",
  "fire",
  "hospital",
  "aed",
  "water",
  "toilets",
  "ev",
  "station",
  "bridge",
] as const;
export type GridKind = (typeof GRID_KINDS)[number];

/** Properties of every grid feature. Geometry is a Point, except power lines (LineString). */
export interface GridProps {
  kind: GridKind;
  /** OpenStreetMap reference, e.g. "node/123". */
  osm: string;
  name: string | null;
  /** The OpenStreetMap tags worth showing, unmodified. */
  tags: Record<string, string>;
  /** The object's own page, from its `website` tags, when it is a plain http(s) address. */
  web: string | null;
  /** Camera viewing directions in degrees (a camera can watch several ways); empty when not mapped. */
  directions: number[];
  /** The object's codes in other registers, from its tags: Wikidata, station and charge point codes. */
  ids: ThingId[];
}

export type GridFeature = GeoJSON.Feature<GeoJSON.Point | GeoJSON.LineString, GridProps>;

export interface GridTile {
  z: number;
  x: number;
  y: number;
  fetchedAt: number;
  features: GridFeature[];
}

/** Entity data for the Profiler: one mapped object and where it is. */
export interface GridRef extends GridProps {
  lat: number;
  lon: number;
}

declare module "../../app/core/plugin" {
  interface EntityKinds {
    grid: GridRef;
  }
}
