import { exactTrip, groupTrips, indexTrips, inScope, matchScore } from "./association";
import { pathFor } from "./geometry";
import { motionLimits, observe, type FilterState } from "./motion";
import { positionAt } from "./fusion";
import type { RoutePath, TripSegment, VehicleLeg, VehicleReport } from "./types";

const MAX_TRACKS = 2000;
const REPLAY_MS = 180_000;
const MAX_EVENTS = 256;
const MAX_AGE_MS = 300_000;

interface ReplayState {
  motion: FilterState;
  recoveries: number;
}

interface Track {
  events: VehicleReport[];
  revision: number;
  vehicle?: TripSegment;
  path: RoutePath | null;
  checkpoint: ReplayState | null;
  checkpointAt: number;
  filtered: ReplayState | null;
  dirty: boolean;
  dirtyFrom: number;
}

const eventTime = (report: VehicleReport): number => report.fix.at || report.fix.receivedAt || 0;

function runKey(report: VehicleReport): string {
  return `${report.tripId}:${report.fix.serviceDate ?? ""}:${report.fix.startTime ?? ""}`;
}

function valid(report: VehicleReport, now: number): boolean {
  const f = report.fix;
  return !!report.id && Number.isFinite(f.lon) && Math.abs(f.lon) <= 180 && Number.isFinite(f.lat) && Math.abs(f.lat) <= 90 && Number.isFinite(f.at) && (f.at > 0 || f.at === 0 && f.evidence === "route-distance" && !!f.receivedAt) && eventTime(report) <= now + 5000 && now - eventTime(report) <= MAX_AGE_MS && (f.speedMs == null || Number.isFinite(f.speedMs) && f.speedMs >= 0);
}

/** Owns observation history independently of view queries or provider snapshots. */
export class VehicleTracker {
  private readonly tracks = new Map<string, Track>();
  private readonly served = new Map<string, number>();
  private revision = 0;
  private readonly routes = new Map<string, { legs: VehicleLeg[] | null; retryAfter: number }>();

  hasRoute(tripId: string): boolean {
    const route = this.routes.get(tripId);
    return !!route && (route.legs !== null || performance.now() < route.retryAfter);
  }
  setRoute(tripId: string, legs: VehicleLeg[]): void {
    this.routes.set(tripId, { legs: pathFor(legs) ? legs : null, retryAfter: performance.now() + 60_000 });
    if (this.routes.size > MAX_TRACKS) this.routes.delete(this.routes.keys().next().value ?? "");
  }

  update(segments: readonly TripSegment[], reports: readonly VehicleReport[], now: number): TripSegment[] {
    const anonymousGenerations = new Map(reports.filter(report => report.identity === "anonymous").map(report => [report.source, report.fix.receivedAt ?? 0]));
    for (const [key, track] of this.tracks) {
      const latest = track.events.at(-1);
      if (!latest || now - eventTime(latest) > MAX_AGE_MS || latest.identity === "anonymous" && (latest.fix.receivedAt ?? 0) < (anonymousGenerations.get(latest.source) ?? 0)) this.tracks.delete(key);
    }
    for (const [id, until] of this.served) if (now > until) this.served.delete(id);
    for (const report of reports) {
      if (!valid(report, now)) continue;
      const key = `${report.source}:${report.id}`;
      let track = this.tracks.get(key);
      if (!track) {
        if (this.tracks.size >= MAX_TRACKS) this.tracks.delete(this.tracks.keys().next().value ?? "");
        track = { events: [], revision: 0, path: null, checkpoint: null, checkpointAt: 0, filtered: null, dirty: true, dirtyFrom: 0 };
        this.tracks.set(key, track);
      }
      if (track.events.some(event => eventTime(event) === eventTime(report)) || eventTime(report) <= track.checkpointAt) continue;
      const latest = track.events.at(-1);
      if (latest && eventTime(latest) - eventTime(report) > REPLAY_MS) continue;
      if (!track.dirty) track.dirtyFrom = track.events.length;
      if (latest && eventTime(report) < eventTime(latest)) track.dirtyFrom = 0;
      track.events.push(report);
      track.events.sort((a, b) => eventTime(a) - eventTime(b));
      track.dirty = true;
      track.revision = ++this.revision;
    }
    const groups = groupTrips(segments, now);
    const tripIndex = indexTrips(groups);
    const byId = new Map(groups.flatMap(group => (group.tripIds ?? [group.tripId]).map(id => [id, group] as const)));
    const byRoute = new Map<string, TripSegment[]>();
    for (const group of groups) { const route = byRoute.get(group.route) ?? []; route.push(group); byRoute.set(group.route, route); }
    const claimed = new Set<TripSegment>();
    const output: TripSegment[] = [];
    for (const [key, track] of this.tracks) {
      const report = track.events.at(-1);
      if (!report) continue;
      const old = track.vehicle;
      const sameRun = old?.fix && `${old.fix.tripId}:${old.fix.serviceDate ?? ""}:${old.fix.startTime ?? ""}` === runKey(report);
      const exact = (tripIndex.get(`${report.scope}:${report.tripId}`) ?? []).filter(g => exactTrip(g, report));
      let known = exact.length === 1 ? exact[0] : undefined;
      if (!known && sameRun && old) known = (old.tripIds ?? [old.tripId]).flatMap(id => byId.get(id) ?? [])[0] ?? old;
      if (!known) {
        const candidates = (byRoute.get(report.route) ?? []).filter(g => !claimed.has(g)).flatMap(group => {
          const score = matchScore(group, report);
          return score === null ? [] : [{ group, score }];
        }).sort((a, b) => a.score - b.score);
        if (candidates[0] && (!candidates[1] || candidates[1].score - candidates[0].score >= 20)) known = candidates[0].group;
      }
      if (known) {
        claimed.add(known);
        for (const id of known.tripIds ?? [known.tripId]) this.served.set(id, Math.min(now + 21_600_000, Math.max(known.arrival + 600_000, now + MAX_AGE_MS)));
      }
      const modes = !known && report.mode === "OTHER" ? new Set((byRoute.get(report.route) ?? []).filter(g => inScope(g, report.scope)).map(g => g.mode)) : new Set<string>();
      const mode = known?.mode ?? (report.mode !== "OTHER" ? report.mode : modes.size === 1 ? [...modes][0] ?? "OTHER" : "OTHER");
      const metadata: TripSegment = known ?? { tripId: `${report.source}:${report.tripId}`, route: report.route, mode, from: null, to: null, departure: report.fix.at, arrival: report.fix.at, delayMin: report.delayMin, realTime: false, line: [], occupancy: report.occupancy, fix: null };
      const route = this.routes.get(metadata.tripId)?.legs;
      const base = route ? { ...metadata, legs: route } : metadata;
      const path = pathFor(base.legs ?? [base]);
      if (path?.id !== track.path?.id || !sameRun) {
        track.path = path;
        track.checkpoint = null;
        track.checkpointAt = 0;
        track.dirty = true;
        track.dirtyFrom = 0;
        track.revision = ++this.revision;
      }
      const limits = motionLimits(mode);
      const tracked = (state: ReplayState, precise = state.recoveries >= 2): TripSegment => ({ ...base, mode, vehicleId: key, fix: state.motion.fix, occupancy: report.occupancy ?? base.occupancy, delayMin: report.delayMin ?? base.delayMin, tracking: { revision: track.revision, at: state.motion.fix.at, pathId: track.path?.id ?? null, ...(track.path ? { path: track.path } : {}), states: state.motion.states, ...limits, lateralM: state.motion.lateralM, relocalized: state.motion.relocalized, precise } });
      if (track.dirty) {
        const step = (filtered: ReplayState | null, event: VehicleReport): ReplayState | null => {
          const motion = observe(filtered?.motion ?? null, event, track.path, mode);
          if (motion.fix === event.fix) {
            let recoveries = filtered?.recoveries ?? 2;
            if (filtered && positionAt(tracked(filtered, true), eventTime(event))?.quality === "last-known") recoveries = 0;
            const ranked = [...motion.states].sort((a, b) => b.weight - a.weight);
            let mass = 0;
            const ranges: { from: number; to: number; section: number }[] = [];
            for (const state of ranked) {
              const error = 1.96 * Math.sqrt(state.p00) + motion.lateralM;
              ranges.push({ from: state.s - error, to: state.s + error, section: state.section });
              mass += state.weight;
              if (mass >= 0.95) break;
            }
            const narrow = ranges.length > 0 && ranges.every(r => r.section === ranges[0]?.section) && Math.max(...ranges.map(r => r.to)) - Math.min(...ranges.map(r => r.from)) < 100;
            filtered = { motion, recoveries: narrow ? Math.min(2, recoveries + 1) : 0 };
          } else if (filtered) filtered = { ...filtered, motion };
          return filtered;
        };
        const cutoff = Math.max(0, track.events.findIndex(event => eventTime(event) >= eventTime(report) - REPLAY_MS), track.events.length - MAX_EVENTS);
        let checkpoint = track.checkpoint;
        for (const event of track.events.slice(0, cutoff)) { checkpoint = step(checkpoint, event); track.checkpointAt = eventTime(event); }
        let filtered = track.dirtyFrom > 0 ? track.filtered : checkpoint;
        const from = track.dirtyFrom > 0 ? track.dirtyFrom : cutoff;
        for (const event of track.events.slice(from)) filtered = step(filtered, event);
        track.checkpoint = checkpoint;
        track.events = track.events.slice(cutoff);
        track.filtered = filtered;
        track.dirty = false;
      }
      const filtered = track.filtered;
      if (!filtered || now - (filtered.motion.fix.at || filtered.motion.fix.receivedAt || 0) > MAX_AGE_MS) continue;
      const vehicle = tracked(filtered);
      track.vehicle = vehicle;
      output.push(vehicle);
    }
    return [...groups.filter(g => !claimed.has(g) && !(g.tripIds ?? [g.tripId]).some(id => this.served.has(id))), ...output];
  }

  get(id: string): TripSegment | undefined {
    return this.tracks.get(id)?.vehicle;
  }

  get size(): number { return this.tracks.size; }
}
