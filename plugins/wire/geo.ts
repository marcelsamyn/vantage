import { distanceM, type LatLon } from "../../shared/geo";

const rad = (d: number): number => (d * Math.PI) / 180;
const deg = (r: number): number => (r * 180) / Math.PI;

export type Position = [lon: number, lat: number];

/**
 * Points along the great circle from `a` to `b`, as [lon, lat]. Longitudes are unwrapped so the line never jumps
 * across the antimeridian; the map draws it past ±180° and `withWorldCopy` supplies the matching piece on the other side.
 */
export function greatCircle(a: LatLon, b: LatLon, steps = 64): Position[] {
  const [p1, l1, p2, l2] = [rad(a.lat), rad(a.lon), rad(b.lat), rad(b.lon)];
  const d = 2 * Math.asin(Math.min(1, Math.sqrt(Math.sin((p2 - p1) / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin((l2 - l1) / 2) ** 2)));
  // Same place, or exactly opposite points where the great circle is not unique.
  if (d < 1e-9 || Math.sin(d) < 1e-6) {
    return [
      [a.lon, a.lat],
      [b.lon, b.lat],
    ];
  }
  const line: Position[] = [];
  let prev = a.lon;
  for (let i = 0; i <= steps; i++) {
    const f = i / steps;
    const k1 = Math.sin((1 - f) * d) / Math.sin(d);
    const k2 = Math.sin(f * d) / Math.sin(d);
    const x = k1 * Math.cos(p1) * Math.cos(l1) + k2 * Math.cos(p2) * Math.cos(l2);
    const y = k1 * Math.cos(p1) * Math.sin(l1) + k2 * Math.cos(p2) * Math.sin(l2);
    const z = k1 * Math.sin(p1) + k2 * Math.sin(p2);
    let lon = deg(Math.atan2(y, x));
    while (lon - prev > 180) lon -= 360;
    while (lon - prev < -180) lon += 360;
    prev = lon;
    line.push([lon, deg(Math.atan2(z, Math.hypot(x, y)))]);
  }
  return line;
}

/** The line itself plus a copy shifted by 360° when it leaves [-180, 180], so it shows on whichever world copy is in view. */
export function withWorldCopy(line: Position[]): Position[][] {
  const lons = line.map((p) => p[0]);
  const shift = Math.max(...lons) > 180 ? -360 : Math.min(...lons) < -180 ? 360 : 0;
  return shift === 0 ? [line] : [line, line.map(([lon, lat]): Position => [lon + shift, lat])];
}

/** The point `f` (0–1) of the way along a line. */
export function along(line: Position[], f: number): Position {
  const at = Math.min(1, Math.max(0, f)) * (line.length - 1);
  const i = Math.min(line.length - 2, Math.floor(at));
  const [a, b] = [line[i], line[i + 1]];
  if (!a || !b) return line[0] ?? [0, 0];
  const t = at - i;
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/** Width of the map area City leaves free for a layer, in degrees of longitude at zoom 0 (about 1000 px of a 512 px world). */
const VIEW_SPAN_DEG = 703;
/** City's layer panel covers the left of the map; centre a little west of the points so they sit in the clear part. */
const PANEL_SHIFT = 0.07;

/** Centre and zoom that frame all points, for City's "fly" intent. Longitude is unwrapped so a Pacific route stays together. */
export function frame(points: LatLon[]): { lat: number; lon: number; zoom: number } {
  const first = points[0];
  if (!first) return { lat: 0, lon: 0, zoom: 2 };
  const lons = points.map((p) => {
    let lon = p.lon;
    while (lon - first.lon > 180) lon -= 360;
    while (lon - first.lon < -180) lon += 360;
    return lon;
  });
  const lats = points.map((p) => p.lat);
  const [west, east] = [Math.min(...lons), Math.max(...lons)];
  const [south, north] = [Math.min(...lats), Math.max(...lats)];
  const span = Math.max((east - west) * 1.45, (north - south) * 2, 0.5);
  const zoom = Math.min(11, Math.max(1.4, Math.log2(VIEW_SPAN_DEG / span)));
  const lon = (west + east) / 2 - PANEL_SHIFT * (VIEW_SPAN_DEG / 2 ** zoom);
  return { lat: (south + north) / 2, lon: ((lon + 540) % 360) - 180, zoom: Math.round(zoom * 10) / 10 };
}

/**
 * Light travels about 200 km per millisecond in fibre. A reply that came back faster than the round trip to the
 * claimed location allows means the address is served from somewhere closer (anycast), so the location is doubtful.
 */
export function locationDoubtful(origin: LatLon, at: LatLon, rttMs: number): boolean {
  const minRttMs = distanceM(origin, at) / 1000 / 100;
  return rttMs < minRttMs * 0.9;
}
