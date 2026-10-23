import { z } from "zod";
import { bearingDeg, destination, distanceM } from "../../shared/geo";
import { positionAt } from "./fusion";
import { decodePolyline, projectOnPath } from "./geometry";
import { RtVehicleShape } from "./gtfsrt";
import { romeReports } from "./rome.server";
import { VehicleTracker } from "./tracker";
import type { TripSegment, VehicleReport } from "./types";

const RecordedStop = z.object({ name: z.string(), stopId: z.string(), lat: z.number(), lon: z.number() });
export const RecordedSegments = z.array(z.object({ trips: z.array(z.object({ tripId: z.string(), routeShortName: z.string().optional() })), mode: z.string(), from: RecordedStop, to: RecordedStop, departure: z.string(), arrival: z.string(), realTime: z.boolean(), polyline: z.string() }));
export const Recording = z.object({ source: z.string(), receiptClock: z.string(), segments: RecordedSegments, samples: z.array(z.object({ receivedAt: z.number(), producedAt: z.number().nullable(), vehicles: z.array(RtVehicleShape) })) });

interface ReplayPoint {
  age: number;
  estimated: boolean;
  error: number;
  hold: number;
  constant: number;
  rangeM: number | null;
  covered: boolean;
}

interface ReplayMetrics {
  scored: number;
  estimated: number;
  withheld: number;
  medianErrorM: number | null;
  p95ErrorM: number | null;
  matchedHoldMedianM: number | null;
  displayMedianErrorM: number | null;
  holdMedianM: number | null;
  constantMedianM: number | null;
  rangeScored: number;
  rangeCovered: number;
  medianRangeM: number | null;
}

function metrics(points: ReplayPoint[]): ReplayMetrics {
  const estimates = points.filter(p => p.estimated);
  const ranged = points.filter(p => p.rangeM !== null);
  return { scored: points.length, estimated: estimates.length, withheld: points.length - estimates.length, medianErrorM: quantile(estimates.map(p => p.error), 0.5), p95ErrorM: quantile(estimates.map(p => p.error), 0.95), matchedHoldMedianM: quantile(estimates.map(p => p.hold), 0.5), displayMedianErrorM: quantile(points.map(p => p.error), 0.5), holdMedianM: quantile(points.map(p => p.hold), 0.5), constantMedianM: quantile(points.map(p => p.constant), 0.5), rangeScored: ranged.length, rangeCovered: ranged.filter(p => p.covered).length, medianRangeM: quantile(ranged.map(p => p.rangeM ?? 0), 0.5) };
}

export function replayRecording(recording: z.infer<typeof Recording>): ReplayMetrics & { observations: number; medianAgeS: number | null; byAge: (ReplayMetrics & { age: string })[] } {
  const segments: TripSegment[] = recording.segments.map(s => ({ tripId: s.trips[0]?.tripId ?? "", tripIds: s.trips.map(t => t.tripId), route: s.trips[0]?.routeShortName ?? "", mode: s.mode, from: s.from, to: s.to, departure: Date.parse(s.departure), arrival: Date.parse(s.arrival), realTime: s.realTime, delayMin: null, line: decodePolyline(s.polyline), occupancy: null, fix: null }));
  const tracker = new VehicleTracker();
  const samples = [...recording.samples].sort((a, b) => a.receivedAt - b.receivedAt);
  const truths = samples.flatMap(s => romeReports(s.vehicles)).sort((a, b) => a.fix.at - b.fix.at);
  const seen = new Set<string>();
  const history = new Map<string, VehicleReport[]>();
  const points: ReplayPoint[] = [];
  let next = 0;
  for (const truth of truths) {
    const key = `${truth.source}:${truth.id}`;
    const event = `${key}:${truth.fix.at}`;
    if (seen.has(event)) continue;
    seen.add(event);
    while (samples[next] && (samples[next]?.receivedAt ?? Infinity) <= truth.fix.at) {
      const sample = samples[next++];
      if (!sample) continue;
      const reports = romeReports(sample.vehicles);
      tracker.update(segments, reports, sample.receivedAt);
      for (const report of reports) {
        const id = `${report.source}:${report.id}`;
        const fixes = history.get(id) ?? [];
        if (!fixes.some(f => f.fix.at === report.fix.at)) history.set(id, [...fixes, report].sort((a, b) => a.fix.at - b.fix.at).slice(-2));
      }
    }
    const vehicle = tracker.get(key);
    if (!vehicle?.fix || vehicle.fix.at >= truth.fix.at) continue;
    const age = (truth.fix.at - vehicle.fix.at) / 1000;
    if (age > 300) continue;
    const prediction = positionAt(vehicle, truth.fix.at);
    const fixes = history.get(key) ?? [];
    const last = fixes.at(-1)?.fix, previous = fixes.at(-2)?.fix;
    const dt = last && previous ? (last.at - previous.at) / 1000 : 0;
    const speed = last?.speedMs ?? (last && previous && dt > 0 ? Math.min(35, distanceM(previous, last) / dt) : 0);
    const bearing = last?.bearing ?? (last && previous ? bearingDeg(previous, last) : 0);
    const constant = last ? destination(last, bearing, Math.min(120, (truth.fix.at - last.at) / 1000) * Math.min(35, speed)) : vehicle.fix;
    const path = vehicle.tracking?.path;
    const covered = !!(path && prediction?.ranges.length && projectOnPath(path, truth.fix).some(p => p.distance <= 30 + (vehicle.tracking?.lateralM ?? 0) && prediction.ranges.some(r => r.section === p.section && r.from <= p.s && p.s <= r.to)));
    points.push({ age, estimated: prediction?.quality === "estimated", error: distanceM(prediction ?? vehicle.fix, truth.fix), hold: distanceM(vehicle.fix, truth.fix), constant: distanceM(constant, truth.fix), rangeM: prediction?.ranges.length ? prediction.rangeM : null, covered });
  }
  const boundaries = [0, 15, 30, 60, 120, 300];
  const byAge = boundaries.slice(1).map((end, i) => {
    const start = boundaries[i] ?? 0;
    return { age: `${start}-${end}s`, ...metrics(points.filter(p => p.age > start && p.age <= end)) };
  });
  return { observations: seen.size, ...metrics(points), medianAgeS: quantile(points.map(p => p.age), 0.5), byAge };
}

function quantile(values: number[], fraction: number): number | null {
  if (!values.length) return null;
  values.sort((a, b) => a - b);
  return values[Math.min(values.length - 1, Math.floor(values.length * fraction))] ?? null;
}

export function benchmarkTracking(): { tracks: number; updateP95Ms: number | null; evaluationP95Ms: number | null; heapMiB: number } {
  const now = Date.UTC(2026, 9, 16);
  const segments: TripSegment[] = Array.from({ length: 1000 }, (_, i) => ({ tripId: `20261016_14:00_it-Lazio-Rome_${i}`, route: "64", mode: "BUS", from: null, to: null, departure: now - 60_000, arrival: now + 300_000, delayMin: null, realTime: false, line: [[12.49, 41.9], [12.53, 41.9]], occupancy: null, fix: null }));
  const tracker = new VehicleTracker();
  Bun.gc(true);
  const initial = process.memoryUsage().heapUsed;
  const updates: number[] = [], evaluations: number[] = [];
  for (let generation = 0; generation < 20; generation++) {
    const at = now + generation * 10_000;
    const reports: VehicleReport[] = segments.map((_, i) => ({ source: "atac", scope: "it-Lazio-Rome", id: String(i), tripId: String(i), route: "64", mode: "BUS", stopId: "", delayMin: null, occupancy: null, fix: { lon: 12.5 + generation * 0.0005, lat: 41.9, at, speedMs: 4, feed: "ATAC", label: String(i), tripId: String(i) } }));
    const before = performance.now();
    const vehicles = tracker.update(segments, reports, at);
    const after = performance.now();
    for (const v of vehicles) positionAt(v, at + 10_000);
    if (generation >= 3) { updates.push(after - before); evaluations.push(performance.now() - after); }
  }
  Bun.gc(true);
  return { tracks: tracker.size, updateP95Ms: quantile(updates, 0.95), evaluationP95Ms: quantile(evaluations, 0.95), heapMiB: Math.max(0, process.memoryUsage().heapUsed - initial) / 1024 ** 2 };
}

if (import.meta.main) {
  const path = process.argv[2] ?? new URL("./fixtures/rome-tracking.json", import.meta.url).pathname;
  const recording = Recording.parse(await Bun.file(path).json());
  console.log(JSON.stringify({ recording: path, replay: replayRecording(recording), benchmark: benchmarkTracking(), limitation: "Provider GPS is a reference, not independent ground truth. This short sample cannot establish held-out Rome accuracy." }, null, 2));
}
