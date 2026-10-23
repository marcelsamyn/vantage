import type { LatLon } from "../../shared/geo";
import type { Box, PostSourceId } from "./types";

/**
 * Areas are rounded outward to a grid before anyone asks a source, so views that differ by a small pan share one
 * cached answer. The server rounds every request itself; the browser rounds the same way only to know when to ask again.
 */

/** Grid steps in degrees, finest first. */
const STEPS = [0.02, 0.05, 0.1, 0.25, 0.5, 1, 2] as const;
const COARSEST = 4;
/** The largest area one request covers, in degrees per side. A wider view is cropped around its centre. */
export const MAX_SPAN = 8;

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
// Six decimals keep keys stable against floating-point noise such as 0.30000000000000004.
const tidy = (v: number): number => Math.round(v * 1e6) / 1e6;

/** The smallest grid step that splits the larger side of the area into at most `cells` cells. */
function stepFor(span: number, cells: number): number {
  return STEPS.find((s) => s * cells >= span) ?? COARSEST;
}

/**
 * Round a view outward to a grid that suits its size. `cells` sets how coarse the grid is: fewer cells make
 * bigger steps, so more views share one answer.
 */
export function snapBox(view: Box, cells = 4): Box {
  let west = clamp(Math.min(view.west, view.east), -180, 180);
  let east = clamp(Math.max(view.west, view.east), -180, 180);
  let south = clamp(Math.min(view.south, view.north), -90, 90);
  let north = clamp(Math.max(view.south, view.north), -90, 90);
  if (east - west > MAX_SPAN) {
    const mid = (west + east) / 2;
    west = mid - MAX_SPAN / 2;
    east = mid + MAX_SPAN / 2;
  }
  if (north - south > MAX_SPAN) {
    const mid = (south + north) / 2;
    south = mid - MAX_SPAN / 2;
    north = mid + MAX_SPAN / 2;
  }
  const step = stepFor(Math.max(east - west, north - south), cells);
  const down = (v: number): number => tidy(Math.floor(tidy(v / step)) * step);
  const up = (v: number): number => tidy(Math.ceil(tidy(v / step)) * step);
  return { west: clamp(down(west), -180, 180), south: clamp(down(south), -90, 90), east: clamp(up(east), -180, 180), north: clamp(up(north), -90, 90) };
}

/**
 * How coarse each source's grid is: fewer cells across a view make larger areas that more views share.
 * YouTube allows few searches a day, so its areas are the widest.
 */
export const GRID_CELLS: Record<PostSourceId, number> = { inaturalist: 4, fixmystreet: 4, youtube: 2, flickr: 4 };

/**
 * The part of a map view worth asking about. A tilted map's bounds reach toward the horizon, where posts are specks
 * and would crowd the near ones out of a capped answer. So the bounds are cut to a rectangle around the centre,
 * `margin` times what an untilted map of the same size would show. MapLibre's world is 512 px wide at zoom 0.
 */
export function focusBox(bounds: Box, centre: LatLon, zoom: number, widthPx: number, heightPx: number, margin = 2): Box {
  const degPerPx = 360 / (512 * 2 ** zoom);
  const halfLon = (widthPx / 2) * degPerPx * margin;
  const halfLat = (heightPx / 2) * degPerPx * Math.cos((centre.lat * Math.PI) / 180) * margin;
  return {
    west: Math.max(bounds.west, centre.lon - halfLon),
    south: Math.max(bounds.south, centre.lat - halfLat),
    east: Math.min(bounds.east, centre.lon + halfLon),
    north: Math.min(bounds.north, centre.lat + halfLat),
  };
}

export const boxKey = (b: Box): string => `${b.west},${b.south},${b.east},${b.north}`;

export const inBox = (b: Box, p: LatLon): boolean => p.lat >= b.south && p.lat <= b.north && p.lon >= b.west && p.lon <= b.east;

export const boxesMeet = (a: Box, b: Box): boolean => a.west <= b.east && a.east >= b.west && a.south <= b.north && a.north >= b.south;

/** A box that holds the circle of `radiusM` around a point. */
export function boxAround(c: LatLon, radiusM: number): Box {
  const dLat = radiusM / 111_320;
  const dLon = radiusM / (111_320 * Math.max(0.05, Math.cos((c.lat * Math.PI) / 180)));
  return { west: c.lon - dLon, south: c.lat - dLat, east: c.lon + dLon, north: c.lat + dLat };
}

export const boxCentre = (b: Box): LatLon => ({ lat: (b.south + b.north) / 2, lon: (b.west + b.east) / 2 });
