import { api, post, qs } from "../../app/core/api";
import { fmt } from "../../app/core/format";
import { usePoll, type Polled } from "../../app/core/hooks";
import { distanceM, type LatLon } from "../../shared/geo";
import { covers, isFull, type Beacon, type CreatedNote, type EmbedCheck, type LandGrid, type MapNote, type NewNote, type NoteList, type OrderList, type Receiver, type ReceiverList, type ReportLink, type StationDetail, type StationList } from "./types";

// ── Data ──────────────────────────────────────────────────────────

export const fetchReceivers = (signal?: AbortSignal): Promise<ReceiverList> => api<ReceiverList>("/api/reach/receivers", { signal });

export const useReceivers = (): Polled<ReceiverList> => usePoll((signal) => fetchReceivers(signal), 5 * 60_000, []);

export const fetchEmbeddable = (id: string, signal?: AbortSignal): Promise<EmbedCheck> => api<EmbedCheck>(qs("/api/reach/embeddable", { id }), { signal });

export const fetchStations = (signal?: AbortSignal): Promise<StationList> => api<StationList>("/api/reach/stations", { signal });

export const useStations = (): Polled<StationList> => usePoll((signal) => fetchStations(signal), 2 * 60_000, []);

export const fetchStation = (id: number, signal?: AbortSignal): Promise<StationDetail> => api<StationDetail>(qs("/api/reach/station", { id }), { signal });

export const fetchOrders = (center: LatLon, radiusKm: number, signal?: AbortSignal): Promise<OrderList> =>
  api<OrderList>(qs("/api/reach/orders", { lat: center.lat.toFixed(4), lon: center.lon.toFixed(4), radiusKm }), { signal });

export const fetchReportLink = (at: LatLon, signal?: AbortSignal): Promise<ReportLink | null> => api<ReportLink | null>(qs("/api/reach/report-link", { lat: at.lat.toFixed(4), lon: at.lon.toFixed(4) }), { signal });

export const fetchNotes = (box: { west: number; south: number; east: number; north: number }, signal?: AbortSignal): Promise<NoteList> =>
  api<NoteList>(qs("/api/reach/notes", { west: box.west.toFixed(4), south: box.south.toFixed(4), east: box.east.toFixed(4), north: box.north.toFixed(4) }), { signal });

export const sendNote = (note: NewNote): Promise<CreatedNote> => post<CreatedNote>("/api/reach/notes", note);

export const fetchLand = (signal?: AbortSignal): Promise<LandGrid> => api<LandGrid>("/api/reach/land", { signal });

/** Work orders near a point, refreshed every few minutes. Pass null to wait until a position is known. */
export function useOrders(center: LatLon | null, radiusKm: number): Polled<OrderList> {
  const key = center ? `${center.lat.toFixed(2)},${center.lon.toFixed(2)},${radiusKm}` : "none";
  return usePoll((signal) => (center ? fetchOrders(center, radiusKm, signal) : Promise.reject(new Error("No position yet"))), 5 * 60_000, [key], center === null);
}

/** Open notes around a point (a box of about 0.2° on each side). */
export function useNotesAround(center: LatLon | null): Polled<NoteList> {
  const key = center ? `${center.lat.toFixed(2)},${center.lon.toFixed(2)}` : "none";
  return usePoll(
    (signal) => (center ? fetchNotes({ west: center.lon - 0.1, east: center.lon + 0.1, south: center.lat - 0.1, north: center.lat + 0.1 }, signal) : Promise.reject(new Error("No position yet"))),
    5 * 60_000,
    [key],
    center === null,
  );
}

// ── Geometry over the lists ───────────────────────────────────────

export interface Ranked<T> {
  item: T;
  distanceM: number;
}

/** The `n` items closest to `from`, nearest first. */
export function nearest<T extends LatLon>(items: readonly T[], from: LatLon, n: number): Ranked<T>[] {
  return items
    .map((item) => ({ item, distanceM: distanceM(from, item) }))
    .sort((a, b) => a.distanceM - b.distanceM)
    .slice(0, n);
}

/** A receiver you can tune right now: it has a free slot. */
export const receiverIsFree = (r: Receiver): boolean => !isFull(r);

/**
 * Free receivers that cover a station's frequency: the nearest few to you, then others spread out to the farthest,
 * so the list shows the same signal arriving at very different distances.
 */
export function hearFrom(receivers: readonly Receiver[], beacon: Beacon, here: LatLon, near = 4, far = 4): Ranked<Receiver>[] {
  const ranked = receivers
    .filter((r) => receiverIsFree(r) && covers(r, beacon.kHz))
    .map((item) => ({ item, distanceM: distanceM(here, item) }))
    .sort((a, b) => a.distanceM - b.distanceM);
  if (ranked.length <= near + far) return ranked;
  const rest = ranked.slice(near);
  const spread = Array.from({ length: far }, (_, i) => rest[Math.round(((i + 1) / far) * (rest.length - 1))]).filter((r): r is Ranked<Receiver> => r !== undefined);
  return [...ranked.slice(0, near), ...spread];
}

export const noteIsOpen = (n: MapNote): boolean => n.status === "open";

/** "10 kHz – 30 MHz" */
export function formatBand(minHz: number, maxHz: number): string {
  const f = (hz: number): string => (hz >= 1e6 ? `${fmt.one(hz / 1e6)} MHz` : `${fmt.int(hz / 1000)} kHz`);
  return `${f(minHz)} – ${f(maxHz)}`;
}
