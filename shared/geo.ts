/** Pure geodesy helpers shared by server and client. Angles in degrees, distances in metres. */

export interface LatLon {
  lat: number;
  lon: number;
}

export interface GeoBox {
  west: number;
  south: number;
  east: number;
  north: number;
}

/** MapLibre bounds can cross the date line or refer to another copy of the world. */
export function geographicBox(view: GeoBox): GeoBox {
  const longitude = (n: number): number => ((n + 180) % 360 + 360) % 360 - 180;
  const world = view.east - view.west >= 360;
  return { west: world ? -180 : longitude(view.west), east: world ? 180 : longitude(view.east), south: Math.max(-90, view.south), north: Math.min(90, view.north) };
}

/** APIs that require west < east need two rectangles for a date-line view. */
export function geographicBoxes(view: GeoBox): GeoBox[] {
  const box = geographicBox(view);
  return box.west > box.east ? [{ ...box, east: 180 }, { ...box, west: -180 }].filter((part) => part.west < part.east) : [box];
}

const R_EARTH = 6_371_008.8;
const rad = (d: number): number => (d * Math.PI) / 180;
const deg = (r: number): number => (r * 180) / Math.PI;

export function distanceM(a: LatLon, b: LatLon): number {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial bearing from a to b, 0–360, clockwise from true north. */
export function bearingDeg(a: LatLon, b: LatLon): number {
  const y = Math.sin(rad(b.lon - a.lon)) * Math.cos(rad(b.lat));
  const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lon - a.lon));
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

/** Point reached from `from` after `distance` metres on `bearing`. */
export function destination(from: LatLon, bearing: number, distance: number): LatLon {
  const d = distance / R_EARTH;
  const b = rad(bearing);
  const lat1 = rad(from.lat);
  const lon1 = rad(from.lon);
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(b));
  const lon2 = lon1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
  return { lat: deg(lat2), lon: ((deg(lon2) + 540) % 360) - 180 };
}

/**
 * Azimuth and elevation of a target seen from an observer on the ground.
 * Accounts for Earth curvature, which matters for aircraft 100+ km away.
 */
export function lookAngle(observer: LatLon & { altM?: number }, target: LatLon & { altM: number }): { az: number; el: number; rangeM: number } {
  const toEcef = (p: LatLon, h: number): [number, number, number] => {
    const a = 6_378_137;
    const e2 = 6.69437999014e-3;
    const sLat = Math.sin(rad(p.lat));
    const n = a / Math.sqrt(1 - e2 * sLat * sLat);
    return [(n + h) * Math.cos(rad(p.lat)) * Math.cos(rad(p.lon)), (n + h) * Math.cos(rad(p.lat)) * Math.sin(rad(p.lon)), (n * (1 - e2) + h) * sLat];
  };
  const o = toEcef(observer, observer.altM ?? 0);
  const t = toEcef(target, target.altM);
  const [dx, dy, dz] = [t[0] - o[0], t[1] - o[1], t[2] - o[2]];
  const sLat = Math.sin(rad(observer.lat));
  const cLat = Math.cos(rad(observer.lat));
  const sLon = Math.sin(rad(observer.lon));
  const cLon = Math.cos(rad(observer.lon));
  const east = -sLon * dx + cLon * dy;
  const north = -sLat * cLon * dx - sLat * sLon * dy + cLat * dz;
  const up = cLat * cLon * dx + cLat * sLon * dy + sLat * dz;
  const rangeM = Math.hypot(east, north, up);
  return { az: (deg(Math.atan2(east, north)) + 360) % 360, el: deg(Math.asin(up / rangeM)), rangeM };
}

const COMPASS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"] as const;
export function compassPoint(bearing: number): string {
  return COMPASS[Math.round((((bearing % 360) + 360) % 360) / 22.5) % 16] ?? "N";
}

type Rings = readonly (readonly (readonly number[])[])[];
/** A GeoJSON polygon or multipolygon, positions as [lon, lat]. */
export type Area = { type: "Polygon"; coordinates: Rings } | { type: "MultiPolygon"; coordinates: readonly Rings[] };

/** Ray casting on one ring: a point is inside when a ray to the east crosses the ring an odd number of times. */
function inRing(at: LatLon, ring: Rings[number]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi = 0, yi = 0] = ring[i] ?? [];
    const [xj = 0, yj = 0] = ring[j] ?? [];
    if (yi > at.lat !== yj > at.lat && at.lon < ((xj - xi) * (at.lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function inPolygon(at: LatLon, rings: Rings): boolean {
  const [outer, ...holes] = rings;
  return outer !== undefined && inRing(at, outer) && !holes.some((hole) => inRing(at, hole));
}

/** Whether a point lies inside an area, outside its holes. */
export function inArea(at: LatLon, area: Area): boolean {
  return area.type === "Polygon" ? inPolygon(at, area.coordinates) : area.coordinates.some((p) => inPolygon(at, p));
}
