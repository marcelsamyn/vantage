import { projectOnPath, pathFor } from "./geometry";
import type { TripSegment, VehicleLeg, VehicleReport } from "./types";

function tripParts(id: string): { feed: string; id: string } | null {
  const parts = /^\d{8}_\d{2}:\d{2}_([^_]+)_(.+)$/.exec(id);
  return parts?.[1] && parts[2] ? { feed: parts[1], id: parts[2] } : null;
}

export function inScope(vehicle: TripSegment, scope: string): boolean {
  return (vehicle.tripIds ?? [vehicle.tripId]).some(id => {
    const feed = tripParts(id)?.feed;
    return feed === scope || feed?.startsWith(`${scope}-`) === true;
  });
}

export function exactTrip(vehicle: TripSegment, report: VehicleReport): boolean {
  return inScope(vehicle, report.scope) && (vehicle.tripIds ?? [vehicle.tripId]).some(id => tripParts(id)?.id === report.tripId && (!report.fix.serviceDate || id.startsWith(report.fix.serviceDate)));
}

export function indexTrips(groups: readonly TripSegment[]): Map<string, TripSegment[]> {
  const index = new Map<string, TripSegment[]>();
  for (const group of groups) for (const id of group.tripIds ?? [group.tripId]) {
    const parts = tripParts(id);
    if (!parts) continue;
    const feed = parts.feed.split("-");
    for (let length = 1; length <= feed.length; length++) {
      const key = `${feed.slice(0, length).join("-")}:${parts.id}`;
      const matches = index.get(key) ?? [];
      if (!matches.includes(group)) matches.push(group);
      index.set(key, matches);
    }
  }
  return index;
}

const timetableGroups = new WeakMap<readonly TripSegment[], { members: TripSegment[]; legs: VehicleLeg[]; tripIds: string[] }[]>();

/** A shared run owns its connected legs, while physical vehicle ids remain distinct. */
export function groupTrips(segments: readonly TripSegment[], now: number): TripSegment[] {
  let grouped = timetableGroups.get(segments);
  if (!grouped) {
    const groups = new Map<string, TripSegment[]>();
    const keysOf = (s: TripSegment): string[] => s.vehicleId ? [`vehicle:${s.vehicleId}`] : [...new Set([s.tripId, ...(s.tripIds ?? [])])];
    for (const segment of segments) {
      const existing = [...new Set(keysOf(segment).flatMap(key => groups.get(key) ? [groups.get(key)] : []))];
      const group = existing.flatMap(g => g ?? []);
      group.push(segment);
      for (const member of group) for (const key of keysOf(member)) groups.set(key, group);
    }
    grouped = [...new Set(groups.values())].map(group => {
      const byLeg = new Map<string, VehicleLeg>();
      for (const segment of group) for (const leg of segment.legs ?? [segment]) byLeg.set(`${leg.from?.stopId}:${leg.to?.stopId}:${leg.departure}`, { from: leg.from, to: leg.to, departure: leg.departure, arrival: leg.arrival, line: leg.line });
      const legs = [...byLeg.values()].sort((a, b) => a.departure - b.departure);
      return { members: group, legs, tripIds: [...new Set(group.flatMap(s => s.tripIds ?? [s.tripId]))] };
    });
    timetableGroups.set(segments, grouped);
  }
  return grouped.map(({ members: group, legs, tripIds }) => {
    const current = legs.find(l => l.departure <= now && now < l.arrival) ?? legs.find(l => l.arrival >= now) ?? legs.at(-1);
    const first = group[0];
    if (!first) throw new Error("Empty transit run");
    const metadata = group.find(s => s.departure === current?.departure && s.arrival === current.arrival) ?? first;
    return { ...metadata, ...(current ?? {}), legs, tripIds };
  });
}

export function matchScore(vehicle: TripSegment, report: VehicleReport): number | null {
  if (!inScope(vehicle, report.scope) || vehicle.route !== report.route) return null;
  const path = pathFor(vehicle.legs ?? [vehicle]);
  if (!path) return null;
  let best = Infinity;
  for (const p of projectOnPath(path, report.fix)) {
    if (p.distance > (report.stopId ? 80 : 40)) continue;
    if (report.fix.bearing != null && report.fix.speedMs !== 0 && Math.abs(((p.bearing - report.fix.bearing + 540) % 360) - 180) > 90) continue;
    const stop = report.stopId ? path.stops.find(s => s.stopId === `${report.scope}_${report.stopId}` && s.s >= p.s - 40) : undefined;
    if (report.stopId && !stop) continue;
    const section = path.sections[p.section];
    if (!section) continue;
    const lo = path.meters[section.start] ?? 0, hi = path.meters[section.end] ?? 0;
    const start = path.stops.find(s => s.s >= lo)?.departure ?? vehicle.departure;
    const end = path.stops.findLast(s => s.s <= hi)?.arrival ?? vehicle.arrival;
    const clock = start + (hi > lo ? (p.s - lo) / (hi - lo) : 0) * (end - start);
    const seconds = Math.abs(clock - report.fix.at) / 1000;
    if (seconds > (report.stopId ? 300 : 120)) continue;
    best = Math.min(best, p.distance + seconds / 4);
  }
  return Number.isFinite(best) ? best : null;
}
