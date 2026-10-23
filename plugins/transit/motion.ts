import { distanceM } from "../../shared/geo";
import { projectOnPath, type PathProjection } from "./geometry";
import type { MotionState, RoutePath, VehicleFix, VehicleReport } from "./types";

export interface FilterState {
  fix: VehicleFix;
  states: MotionState[];
  lateralM: number;
  relocalized: boolean;
  rejected: VehicleFix | null;
}

export function motionLimits(mode: string): { maxSpeed: number; noise: number } {
  if (/RAIL|TRAIN|SUBURBAN/.test(mode)) return { maxSpeed: 100, noise: 0.06 };
  if (/SUBWAY|METRO/.test(mode)) return { maxSpeed: 40, noise: 0.03 };
  if (/FERRY/.test(mode)) return { maxSpeed: 25, noise: 0.01 };
  return { maxSpeed: 35, noise: 0.015 };
}

export function advance(state: MotionState, dt: number, noise: number): MotionState {
  const q = state.stopped ? noise / 4 : noise;
  return { ...state, s: state.s + state.v * dt, p00: state.p00 + 2 * dt * state.p01 + dt * dt * state.p11 + q * dt ** 3 / 3, p01: state.p01 + dt * state.p11 + q * dt * dt / 2, p11: state.p11 + q * dt };
}

function measured(state: MotionState, value: number, variance: number, speed = false): MotionState {
  const denominator = (speed ? state.p11 : state.p00) + variance;
  const k0 = (speed ? state.p01 : state.p00) / denominator;
  const k1 = (speed ? state.p11 : state.p01) / denominator;
  const error = value - (speed ? state.v : state.s);
  return { ...state, s: state.s + k0 * error, v: state.v + k1 * error, p00: Math.max(1, state.p00 - k0 * (speed ? state.p01 : state.p00)), p01: state.p01 - k0 * (speed ? state.p11 : state.p01), p11: Math.max(0.02, state.p11 - k1 * (speed ? state.p11 : state.p01)) };
}

function candidates(path: RoutePath, report: VehicleReport): PathProjection[] {
  return projectOnPath(path, report.fix).filter(p => report.fix.bearing == null || report.fix.speedMs === 0 || Math.abs(((p.bearing - report.fix.bearing + 540) % 360) - 180) <= 90);
}

function initialize(report: VehicleReport, path: RoutePath | null, mode: string, relocalized = false): FilterState {
  const projections = path ? candidates(path, report).slice(0, 3) : [];
  const maxSpeed = motionLimits(mode).maxSpeed;
  const speed = report.fix.speedMs;
  const moving = speed != null && speed > 0.5;
  const stopped = report.fix.stopStatus === "stopped" || speed === 0;
  const states = projections.flatMap((p): MotionState[] => {
    const section = path?.sections[p.section];
    const start = section ? path?.meters[section.start] ?? 0 : 0;
    const end = section ? path?.meters[section.end] ?? 0 : 0;
    const relevant = path?.stops.filter(stop => stop.s >= start && stop.s <= end) ?? [];
    const duration = ((relevant.at(-1)?.arrival ?? 0) - (relevant[0]?.departure ?? 0)) / 1000;
    const priorSpeed = duration > 0 ? Math.min(12, (end - start) / duration) : 5;
    const weight = Math.exp(-(p.distance ** 2) / 800);
    const base = { s: p.s, p00: 225, p01: 0, section: p.section };
    return [
      { ...base, v: Math.min(maxSpeed, speed ?? priorSpeed), p11: speed == null ? 16 : 1, stopped: false, weight: weight * (stopped ? 0.02 : 0.9) },
      { ...base, v: 0, p11: 0.04, stopped: true, weight: weight * (stopped ? 0.98 : moving ? 0.01 : 0.1) },
    ];
  });
  const sum = states.reduce((n, s) => n + s.weight, 0);
  return { fix: report.fix, states: states.map(s => ({ ...s, weight: s.weight / sum })), lateralM: projections[0]?.distance ?? 0, relocalized, rejected: null };
}

function instance(fix: VehicleFix): string {
  return `${fix.tripId ?? ""}:${fix.serviceDate ?? ""}:${fix.startTime ?? ""}`;
}

/** Replaying candidates re-evaluates gates; a rejected point never becomes a speed anchor. */
export function observe(previous: FilterState | null, report: VehicleReport, path: RoutePath | null, mode: string): FilterState {
  if (!previous || report.fix.at === 0 || instance(previous.fix) !== instance(report.fix)) return initialize(report, path, mode, previous !== null);
  const dt = (report.fix.at - previous.fix.at) / 1000;
  if (dt <= 0) return previous;
  const { maxSpeed, noise } = motionLimits(mode);
  const traveled = distanceM(previous.fix, report.fix);
  const projections = path ? candidates(path, report) : [];
  const variance = (report.fix.evidence === "route-distance" ? 40 : 15) ** 2 + ((report.fix.speedMs ?? 10) * (report.fix.timeErrorMs ?? 0) / 1000) ** 2;
  const states: MotionState[] = [];
  const mixed = previous.states.flatMap(state => [
    { ...state, weight: state.weight * 0.98 },
    { ...state, v: state.stopped ? Math.min(8, maxSpeed) : 0, p11: state.stopped ? 9 : 0.04, stopped: !state.stopped, weight: state.weight * 0.02 },
  ]);
  for (const state of mixed) {
    const forecast = advance(state, dt, noise);
    for (const p of projections) {
      if (p.section !== state.section || p.s < state.s - 35 || p.s - state.s > maxSpeed * dt + 40) continue;
      const residual = p.s - forecast.s;
      const totalVariance = forecast.p00 + variance;
      if (Math.abs(residual) > Math.max(60, 4 * Math.sqrt(totalVariance))) continue;
      let updated = measured(forecast, p.s, variance);
      if (report.fix.speedMs != null) updated = measured(updated, report.fix.speedMs, 1, true);
      const observedSpeed = traveled / dt;
      const stopEvidence = report.fix.stopStatus === "stopped" || (traveled < 12 && dt >= 5 && report.fix.speedMs == null) || report.fix.speedMs === 0;
      const modeWeight = state.stopped ? stopEvidence ? 0.98 : observedSpeed > 1 ? 0.02 : 0.5 : stopEvidence ? 0.05 : 0.95;
      states.push({ ...updated, v: Math.max(0, Math.min(maxSpeed, state.stopped && stopEvidence ? 0 : updated.v)), weight: state.weight * Math.exp(-0.5 * residual ** 2 / totalVariance - p.distance ** 2 / 1800) / Math.sqrt(totalVariance) * modeWeight });
    }
  }
  const sum = states.reduce((n, s) => n + s.weight, 0);
  if (sum > 1e-12 && traveled <= maxSpeed * dt + 40) {
    const normalized = states.sort((a, b) => b.weight - a.weight).filter((s, i, all) => !all.slice(0, i).some(other => other.stopped === s.stopped && other.section === s.section && Math.abs(other.s - s.s) < 15)).slice(0, 6);
    const mass = normalized.reduce((n, s) => n + s.weight, 0);
    const best = normalized[0];
    if (best && normalized.every(s => s.stopped) && path) normalized.push({ ...best, v: 3, p11: 9, stopped: false, weight: mass * 0.01 });
    const total = normalized.reduce((n, s) => n + s.weight, 0);
    return { fix: report.fix, states: normalized.map(s => ({ ...s, weight: s.weight / total })), lateralM: projections[0]?.distance ?? 0, relocalized: previous.relocalized, rejected: null };
  }
  if (previous.states.length === 0 && traveled <= maxSpeed * dt + 40) return initialize(report, path, mode);
  const rejected = previous.rejected;
  if (rejected && report.fix.at > rejected.at && distanceM(rejected, report.fix) <= maxSpeed * (report.fix.at - rejected.at) / 1000 + 30) return initialize(report, path, mode, true);
  return { ...previous, rejected: report.fix };
}
