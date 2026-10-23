import { positionAt } from "./fusion";
import { sourceHealth, transitClock } from "./feeds.server";
import { VehicleTracker } from "./tracker";
import type { Bbox } from "./live.server";
import type { TransitSnapshot, TripSegment, VehicleReport } from "./types";

export const vehicleTracker = new VehicleTracker();
const epoch = crypto.randomUUID();
let revision = 0;

export function updateVehicles(segments: readonly TripSegment[], reports: readonly VehicleReport[]): TripSegment[] {
  const clockErrorMs = transitClock.errorMs;
  const timed = reports.map(report => clockErrorMs > 2000 ? { ...report, fix: { ...report.fix, timeErrorMs: Math.max(clockErrorMs, report.fix.timeErrorMs ?? 0) } } : report);
  return vehicleTracker.update(segments, timed, transitClock.now());
}

export function transitSnapshot(segments: readonly TripSegment[], reports: readonly VehicleReport[], box: Bbox, queryKey: string, sources: readonly string[], startedAt: number, focus?: string): TransitSnapshot {
  const now = transitClock.now();
  const clockErrorMs = transitClock.errorMs;
  const paths: TransitSnapshot["paths"] = {};
  const vehicles = updateVehicles(segments, reports).flatMap(vehicle => {
    const p = positionAt(vehicle, now);
    if (!p || (focus ? vehicle.vehicleId !== focus : p.lat < box.minLat || p.lat > box.maxLat || p.lon < box.minLon || p.lon > box.maxLon)) return [];
    if (!vehicle.tracking?.path) return [vehicle];
    const { path, ...tracking } = vehicle.tracking;
    paths[path.id] = path;
    return [{ ...vehicle, tracking }];
  });
  return { epoch, revision: ++revision, serverTime: now, durationMs: Math.max(0, now - startedAt), clockErrorMs, queryKey, sources: sourceHealth().filter(health => sources.includes(health.source)), paths, vehicles };
}
