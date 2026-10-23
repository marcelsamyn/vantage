import { useState } from "react";
import { useInterval } from "../../app/core/hooks";
import { TransitSnapshots, type TransitView } from "./snapshots";
import { api, qs } from "../../app/core/api";
import { profile, useProfile } from "../../app/core/profile";
import { vehicleKey } from "./fusion";
import type { Board, LevelCrossing, Occupancy, RailWork, RailWorks, TrainDetail, TrainMatch, TrainOccupancy, TrainRef, TransitAlert, TransitStop, TripDetail, TripRef, TransitSnapshot } from "./types";

export { positionAt, vehicleKey } from "./fusion";

export interface Bbox {
  west: number;
  south: number;
  east: number;
  north: number;
}

const snapshots = new TransitSnapshots();
let confirming: Promise<void> | null = null;

export function transitNow(): number { return snapshots.now(); }
export function useTransitNow(periodMs = 1000): number {
  const [, tick] = useState(0);
  useInterval(() => tick(n => n + 1), periodMs);
  return transitNow();
}

async function fetchSnapshot(path: string, signal?: AbortSignal): Promise<TransitView> {
  let sent = performance.now();
  let snapshot = await api<TransitSnapshot>(path, { signal, cache: "no-store" });
  if (signal?.aborted) throw new DOMException("Request aborted", "AbortError");
  if (!snapshots.accepts(snapshot.epoch) && !snapshots.isRetired(snapshot.epoch)) {
    if (!confirming) {
      confirming = (async () => {
        const current = await api<TransitSnapshot>(path, { cache: "no-store" });
        snapshots.confirm(current.epoch);
      })().finally(() => { confirming = null; });
    }
    await confirming;
    sent = performance.now();
    snapshot = await api<TransitSnapshot>(path, { signal, cache: "no-store" });
  }
  snapshots.ingest(snapshot, sent, performance.now());
  const view = snapshots.view(snapshot.queryKey);
  const entity = useProfile.getState().entity;
  if (!signal?.aborted && entity?.kind === "vehicle") {
    const current = view.vehicles.find(v => vehicleKey(v) === entity.id);
    if (current && current !== entity.data) useProfile.setState({ entity: { ...entity, data: current } });
  }
  return view;
}

export function fetchTrips(b: Bbox, zoom: number, signal?: AbortSignal): Promise<TransitView> {
  return fetchSnapshot(qs("/api/transit/trips", { minLat: b.south.toFixed(3), minLon: b.west.toFixed(3), maxLat: b.north.toFixed(3), maxLon: b.east.toFixed(3), zoom: Math.round(zoom) }), signal);
}

export function fetchVehicle(id: string, at: { lat: number; lon: number } | null, signal?: AbortSignal): Promise<TransitView> {
  return fetchSnapshot(qs("/api/transit/vehicle", { id, lat: at?.lat, lon: at?.lon }), signal);
}

export const fetchStops = (b: Bbox, signal?: AbortSignal): Promise<TransitStop[]> =>
  api<TransitStop[]>(qs("/api/transit/stops", { minLat: b.south.toFixed(3), minLon: b.west.toFixed(3), maxLat: b.north.toFixed(3), maxLon: b.east.toFixed(3) }), { signal });

export const fetchBoard = (stopId: string, signal?: AbortSignal): Promise<Board> => api<Board>(qs("/api/transit/departures", { stopId }), { signal });

export const fetchOccupancy = (tripId: string, signal?: AbortSignal, vehicleId?: string): Promise<{ occupancy: Occupancy | null; at: number | null; source: string }> =>
  api(qs("/api/transit/occupancy", { tripId, vehicleId }), { signal });

/** Operators keep works, detours and closures open for months. Only a change from the last few days is news. */
const FRESH_MS = 3 * 24 * 3_600_000;

/** Whether an alert is worth a feed event: it began in the last few days, or it is still to come. */
export const isNews = (a: TransitAlert, now: number): boolean => a.from !== null && now - a.from < FRESH_MS;

/** Service alerts on the lines around a place, worst first. */
export const fetchAlerts = (lat: number, lon: number, signal?: AbortSignal): Promise<TransitAlert[]> => api<TransitAlert[]>(qs("/api/transit/alerts", { lat: lat.toFixed(3), lon: lon.toFixed(3) }), { signal });

export function fetchTrain(ref: TrainRef, signal?: AbortSignal): Promise<TrainDetail> {
  return api<TrainDetail>(ref.country === "BE" ? qs("/api/transit/train", { country: "BE", id: ref.vehicleId }) : qs("/api/transit/train", { country: "IT", number: ref.number, origin: ref.origin, date: ref.dateMs }), { signal });
}

export const fetchTrip = (tripId: string, signal?: AbortSignal): Promise<TripDetail> => api<TripDetail>(qs("/api/transit/trip", { tripId }), { signal });

/** Open the trip profile of a run Transitous knows. */
export const openTrip = (ref: TripRef): void => profile.open({ kind: "trip", id: ref.tripId, data: ref });

export const findTrains = (text: string, signal?: AbortSignal): Promise<TrainMatch[]> => api<TrainMatch[]>(qs("/api/transit/train/find", { q: text }), { signal });

/** The id a train gets as a profiled entity. Two refs to the same run share it. */
export const trainEntityId = (ref: TrainRef): string => (ref.country === "BE" ? `be:${ref.vehicleId}` : `it:${ref.number}:${ref.origin ?? ""}:${ref.dateMs ?? ""}`);

export type ModeGroup = "rail" | "metro" | "tram" | "bus" | "ferry" | "other";

export function modeGroup(mode: string): ModeGroup {
  if (/SUBWAY|METRO/.test(mode)) return "metro";
  if (/TRAM|CABLE_CAR|FUNICULAR|AERIAL/.test(mode)) return "tram";
  if (/BUS|COACH/.test(mode)) return "bus";
  if (/RAIL|TRAIN|SUBURBAN/.test(mode)) return "rail";
  if (/FERRY/.test(mode)) return "ferry";
  return "other";
}

export const MODE_LABEL: Record<ModeGroup, string> = { rail: "Train", metro: "Metro", tram: "Tram", bus: "Bus", ferry: "Ferry", other: "Vehicle" };

// ── Delays and crowding ───────────────────────────────────────────

export type DelayTone = "alarm" | "sodium" | "mint";

/** Five minutes or more is late, one to four is slightly late, anything else is on time. */
export const delayTone = (minutes: number): DelayTone => (minutes >= 5 ? "alarm" : minutes >= 1 ? "sodium" : "mint");

export const OCCUPANCY_TEXT: Record<Occupancy, string> = {
  empty: "Empty",
  many_seats: "Many seats free",
  few_seats: "Few seats free",
  standing: "Standing room only",
  crushed: "Crowded, standing only",
  full: "Full",
  closed: "Not taking passengers",
};

/** How many of four pips to fill, and the colour of the pips. */
export const OCCUPANCY_LEVEL: Record<Occupancy, { level: 0 | 1 | 2 | 3 | 4; tone: "mint" | "sodium" | "alarm" }> = {
  empty: { level: 0, tone: "mint" },
  many_seats: { level: 1, tone: "mint" },
  few_seats: { level: 2, tone: "sodium" },
  standing: { level: 3, tone: "sodium" },
  crushed: { level: 4, tone: "alarm" },
  full: { level: 4, tone: "alarm" },
  closed: { level: 4, tone: "alarm" },
};

export interface CrowdingView {
  level: 0 | 1 | 2 | 3 | 4;
  tone: "mint" | "sodium" | "alarm";
  label: string;
}

export const crowdingOf = (o: Occupancy): CrowdingView => ({ ...OCCUPANCY_LEVEL[o], label: OCCUPANCY_TEXT[o] });

/** iRail rates a train's crowding as low, medium or high. */
export const TRAIN_CROWDING: Record<TrainOccupancy, CrowdingView> = {
  low: { level: 1, tone: "mint", label: "Quiet" },
  medium: { level: 2, tone: "sodium", label: "Busy" },
  high: { level: 4, tone: "alarm", label: "Crowded" },
};

// ── Belgian rail works and level crossings ────────────────────────

export const fetchRailWorks = (signal?: AbortSignal): Promise<RailWorks> => api<RailWorks>("/api/transit/rail/works", { signal });
export const fetchCrossings = (signal?: AbortSignal): Promise<LevelCrossing[]> => api<LevelCrossing[]>("/api/transit/rail/crossings", { signal });
/** Restrictions within `radiusM` of a point (the server allows 100 to 5000 m and answers 1500 m when none is given). */
export const fetchWorksNear = (at: { lat: number; lon: number }, signal?: AbortSignal, radiusM?: number): Promise<{ work: RailWork; distanceM: number }[]> =>
  api(qs("/api/transit/rail/near", { lat: at.lat.toFixed(4), lon: at.lon.toFixed(4), radius: radiusM }), { signal });

const dayWords = (iso: string): string => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" });

/** "8 Sep 2025 to 30 May 2027", or one date when the restriction lasts a single day. */
export const workDates = (w: Pick<RailWork, "first" | "last">): string => (w.first === w.last ? dayWords(w.first) : `${dayWords(w.first)} to ${dayWords(w.last)}`);

/** When in the day it applies: nothing to say for a restriction that is in force around the clock. */
export const workHours = (w: Pick<RailWork, "continuity" | "timeFrom" | "timeTo">): string | null => (w.continuity === "Continuous" || !w.timeFrom ? null : `${w.continuity.toLowerCase()}, ${w.timeFrom} to ${w.timeTo}`);

/** Infrabel marks "all tracks" with an asterisk. */
export const trackWords = (tracks: string): string => (tracks === "*" || tracks === "" ? "All tracks" : tracks === "A+B" ? "Both tracks" : `Track ${tracks}`);

export const workTitle = (w: Pick<RailWork, "line" | "start" | "end">): string => (w.start && w.end && w.start !== w.end ? `Line ${w.line}: ${w.start} to ${w.end}` : `Line ${w.line}${w.start ? `, near ${w.start}` : ""}`);

/** How well a crossing is protected, from Infrabel's own wording: barriers, lights only, or a sign only. */
export const protectionOf = (kind: string): "barriers" | "lights" | "passive" => (/barriers/.test(kind) && !/without/.test(kind) ? "barriers" : /^Passive/.test(kind) ? "passive" : "lights");
