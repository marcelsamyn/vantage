import { bearingDeg, distanceM, type LatLon } from "../../shared/geo";
import type { RoutePath, VehicleLeg } from "./types";

export interface PathProjection extends LatLon {
  s: number;
  distance: number;
  bearing: number;
  section: number;
}

const paths = new WeakMap<readonly VehicleLeg[], RoutePath | null>();

export function pathFor(legs: readonly VehicleLeg[]): RoutePath | null {
  const cached = paths.get(legs);
  if (cached !== undefined) return cached;
  const points: [number, number][] = [];
  const meters: number[] = [];
  const sections: RoutePath["sections"] = [];
  const stops: RoutePath["stops"] = [];
  const calls: NonNullable<VehicleLeg["calls"]> = [];
  let section: RoutePath["sections"][number] | undefined;
  let sequence = 0;
  for (const leg of legs) {
    calls.push(...(leg.calls ?? []));
    const first = leg.line[0];
    if (!first || leg.line.length < 2) continue;
    const last = points.at(-1);
    if (!last || distanceM({ lon: last[0], lat: last[1] }, { lon: first[0], lat: first[1] }) > 10) {
      section = { start: points.length, end: points.length };
      sections.push(section);
      points.push(first);
      meters.push(meters.at(-1) ?? 0);
    }
    const start = meters.at(-1) ?? 0;
    if (leg.from) stops.push({ s: start, sequence: sequence++, stopId: leg.from.stopId, departure: leg.departure, arrival: leg.departure });
    for (const point of leg.line.slice(1)) {
      const before = points.at(-1);
      if (!before) continue;
      const length = distanceM({ lon: before[0], lat: before[1] }, { lon: point[0], lat: point[1] });
      if (length === 0) continue;
      points.push(point);
      meters.push((meters.at(-1) ?? 0) + length);
    }
    if (section) section.end = points.length - 1;
    if (leg.to) stops.push({ s: meters.at(-1) ?? 0, sequence: sequence++, stopId: leg.to.stopId, departure: leg.arrival, arrival: leg.arrival });
  }
  if (points.length < 2) { paths.set(legs, null); return null; }
  // Times may change on every poll; geometry identity must not.
  let hash = 2166136261;
  for (const char of JSON.stringify([points, sections])) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  const path = { id: (hash >>> 0).toString(36), points, meters, sections, stops };
  if (calls.length) {
    let previous = -1;
    const ordered: RoutePath["stops"] = [];
    for (const call of calls) {
      const projection = projectOnPath(path, call.stop).filter(p => p.s >= previous - 5).sort((a, b) => a.s - b.s)[0];
      if (!projection) continue;
      ordered.push({ s: projection.s, sequence: ordered.length, stopId: call.stop.stopId, departure: call.departure, arrival: call.arrival });
      previous = projection.s;
    }
    path.stops = ordered;
  }
  paths.set(legs, path);
  return path;
}

export function pointOnPath(path: RoutePath, s: number, sectionIndex: number): LatLon | null {
  const section = path.sections[sectionIndex];
  if (!section || s < (path.meters[section.start] ?? 0) || s > (path.meters[section.end] ?? 0)) return null;
  let lo = section.start, hi = section.end;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >>> 1;
    if ((path.meters[mid] ?? 0) < s) lo = mid;
    else hi = mid;
  }
  const a = path.points[lo], b = path.points[hi];
  if (!a || !b) return null;
  const start = path.meters[lo] ?? 0, end = path.meters[hi] ?? start;
  const f = end > start ? Math.max(0, Math.min(1, (s - start) / (end - start))) : 0;
  return { lon: a[0] + f * (b[0] - a[0]), lat: a[1] + f * (b[1] - a[1]) };
}

export function projectOnPath(path: RoutePath, fix: LatLon): PathProjection[] {
  const candidates: PathProjection[] = [];
  const k = Math.cos(fix.lat * Math.PI / 180);
  for (const [index, section] of path.sections.entries()) {
    for (let i = section.start + 1; i <= section.end; i++) {
      const a = path.points[i - 1], b = path.points[i];
      if (!a || !b) continue;
      const dx = (b[0] - a[0]) * k, dy = b[1] - a[1];
      const d2 = dx * dx + dy * dy;
      const f = d2 ? Math.max(0, Math.min(1, ((fix.lon - a[0]) * k * dx + (fix.lat - a[1]) * dy) / d2)) : 0;
      const at = { lon: a[0] + (b[0] - a[0]) * f, lat: a[1] + (b[1] - a[1]) * f };
      const distance = distanceM(fix, at);
      if (distance > 120) continue;
      candidates.push({ ...at, s: (path.meters[i - 1] ?? 0) + f * ((path.meters[i] ?? 0) - (path.meters[i - 1] ?? 0)), distance, bearing: bearingDeg({ lon: a[0], lat: a[1] }, { lon: b[0], lat: b[1] }), section: index });
    }
  }
  return candidates.sort((a, b) => a.distance - b.distance).filter((p, i, all) => !all.slice(0, i).some(other => other.section === p.section && Math.abs(other.s - p.s) < 20)).slice(0, 12);
}

/** Map and trip endpoints publish different polyline precisions. */
export function decodePolyline(encoded: string, precision = 5): [number, number][] {
  const out: [number, number][] = [];
  let offset = 0, lat = 0, lon = 0;
  while (offset < encoded.length) {
    for (let axis = 0; axis < 2; axis++) {
      let result = 0, shift = 0, byte = 0;
      do {
        if (offset >= encoded.length || shift > 30) throw new Error("Invalid transit route polyline");
        byte = encoded.charCodeAt(offset++) - 63;
        if (byte < 0 || byte > 63) throw new Error("Invalid transit route polyline");
        result |= (byte & 31) << shift;
        shift += 5;
      } while (byte >= 32);
      const delta = result & 1 ? ~(result >>> 1) : result >>> 1;
      if (axis === 0) lat += delta;
      else lon += delta;
    }
    out.push([lon / 10 ** precision, lat / 10 ** precision]);
  }
  return out;
}
