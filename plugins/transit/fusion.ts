import { destination, type LatLon } from "../../shared/geo";
import { pointOnPath, pathFor } from "./geometry";
import { advance } from "./motion";
import type { RoutePath, TripSegment } from "./types";

export const FIX_MAX_AGE_MS = 300_000;
export const PREDICT_MS = 120_000;
export const vehicleKey = (vehicle: TripSegment): string => vehicle.vehicleId ?? vehicle.tripId;

export interface VehiclePosition extends LatLon {
  progress: number;
  estimated: boolean;
  quality: "reported" | "estimated" | "last-known" | "scheduled";
  rangeM: number;
  ranges: { from: number; to: number; section: number }[];
  s?: number;
  pathId?: string;
}

const schedulePaths = new WeakMap<object, RoutePath | null>();

export function positionAt(vehicle: TripSegment, now: number): VehiclePosition | null {
  const fix = vehicle.fix;
  if (!fix) {
    const leg = (vehicle.legs ?? [vehicle]).find(l => l.departure <= now && now < l.arrival);
    if (!leg) return null;
    let path = schedulePaths.get(leg.line);
    if (path === undefined) { path = pathFor([leg]); schedulePaths.set(leg.line, path); }
    if (!path) return null;
    const progress = leg.arrival > leg.departure ? Math.max(0, Math.min(1, (now - leg.departure) / (leg.arrival - leg.departure))) : 0;
    const p = pointOnPath(path, (path.meters.at(-1) ?? 0) * progress, 0);
    return p ? { ...p, progress, estimated: true, quality: "scheduled", rangeM: Infinity, ranges: [] } : null;
  }
  const age = now - fix.at;
  if (fix.at === 0 && fix.evidence === "route-distance" && fix.receivedAt && now - fix.receivedAt <= FIX_MAX_AGE_MS) return { lon: fix.lon, lat: fix.lat, progress: 0, estimated: false, quality: "last-known", rangeM: Infinity, ranges: [] };
  if (age > FIX_MAX_AGE_MS || age < -5000 || fix.at <= 0) return null;
  const seconds = Math.max(0, age / 1000);
  const raw: VehiclePosition = { lon: fix.lon, lat: fix.lat, progress: 0, estimated: false, quality: seconds <= 1 ? "reported" : "last-known", rangeM: 30, ranges: [] };
  const tracking = vehicle.tracking;
  if (seconds <= 1) return raw;
  if (age > PREDICT_MS || (fix.timeErrorMs ?? 0) > 5000) return raw;
  const path = tracking?.path;
  if (!tracking || !path || !tracking.states.length) {
    if (seconds <= 15 && fix.speedMs != null && fix.bearing != null && fix.speedMs > 0 && fix.speedMs <= (tracking?.maxSpeed ?? 35)) return { ...raw, ...destination(fix, fix.bearing, fix.speedMs * seconds), estimated: true, quality: "estimated", rangeM: 30 + seconds * 4 };
    return { ...raw, quality: seconds <= 30 && !tracking ? "reported" : "last-known" };
  }
  const transition = 1 - Math.exp(-seconds / 45);
  const forecasts = tracking.states.flatMap(state => {
    let forecast = advance(state, seconds, tracking.noise);
    if (state.stopped) forecast = { ...forecast, p00: forecast.p00 + (seconds * 0.5) ** 2 };
    else {
      const stop = path.stops.find(stop => stop.s > state.s + 15 && stop.s < forecast.s);
      if (stop && state.v > 0) {
        const afterArrival = seconds - (stop.s - state.s) / state.v;
        const dwell = Math.min(12, Math.max(0, afterArrival));
        forecast = { ...forecast, s: forecast.s - state.v * dwell, p00: forecast.p00 + (state.v * dwell / 2) ** 2 };
      }
    }
    const speed = state.stopped ? Math.min(8, tracking.maxSpeed) : state.v;
    const switched = advance({ ...state, v: speed, stopped: false }, seconds / 2, tracking.noise);
    return [
      { ...forecast, weight: state.weight * (1 - transition) },
      { ...switched, stopped: !state.stopped, p00: switched.p00 + (speed * seconds) ** 2 / 12, weight: state.weight * transition },
    ];
  }).sort((a, b) => b.weight - a.weight);
  const best = forecasts[0];
  if (!best) return raw;
  const ranges: VehiclePosition["ranges"] = [];
  let mass = 0;
  for (const state of forecasts) {
    const error = 1.645 * Math.sqrt(state.p00) + tracking.lateralM;
    ranges.push({ from: state.s - error, to: state.s + error, section: state.section });
    mass += state.weight;
    if (mass >= 0.9) break;
  }
  const min = Math.min(...ranges.map(r => r.from)), max = Math.max(...ranges.map(r => r.to));
  const rangeM = max - min;
  const p = pointOnPath(path, best.s, best.section);
  if (!p || !tracking.precise || ranges.some(r => r.section !== best.section) || rangeM > 150) return { ...raw, rangeM, ranges, pathId: path.id };
  return { ...p, progress: best.s / Math.max(1, path.meters.at(-1) ?? 1), estimated: true, quality: "estimated", rangeM, ranges, s: best.s, pathId: path.id };
}
