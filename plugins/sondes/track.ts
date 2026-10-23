import type { LatLon } from "../../shared/geo";

/**
 * Cut a path where it crosses the date line, so the map draws it as two lines instead of one line across the
 * whole world. The cut points sit exactly on ±180°, at the latitude the straight path between the two fixes crosses.
 */
export function splitAtDateline(path: readonly LatLon[]): [number, number][][] {
  const lines: [number, number][][] = [];
  let line: [number, number][] = [];
  let prev: LatLon | undefined;
  for (const p of path) {
    if (prev && Math.abs(p.lon - prev.lon) > 180) {
      const eastward = prev.lon > 0;
      // Unwrap the second longitude so the two fixes lie on one continuous stretch.
      const unwrapped = p.lon + (eastward ? 360 : -360);
      const edge = eastward ? 180 : -180;
      const t = (edge - prev.lon) / (unwrapped - prev.lon);
      const lat = prev.lat + t * (p.lat - prev.lat);
      line.push([edge, lat]);
      lines.push(line);
      line = [[-edge, lat]];
    }
    line.push([p.lon, p.lat]);
    prev = p;
  }
  if (line.length > 0) lines.push(line);
  return lines.filter((l) => l.length > 1);
}
