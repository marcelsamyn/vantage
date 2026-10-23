import { BusFront, Navigation, Ship, Signpost, TrainFront, TrainFrontTunnel, TramFront, type LucideIcon } from "lucide-react";
import { fmt } from "../../app/core/format";
import type { NearbyItem, NearbyProvider } from "../../app/core/nearby";
import { profile } from "../../app/core/profile";
import { distanceM, type LatLon } from "../../shared/geo";
import { MODE_LABEL, OCCUPANCY_TEXT, fetchBoard, fetchStops, fetchTrips, modeGroup, positionAt, transitNow, vehicleKey, type ModeGroup } from "./client";
import { FIX_MAX_AGE_MS } from "./fusion";
import type { Board, TransitStop, TripSegment } from "./types";

/** Stops worth a walk for a departure: the nearest few, never further than this. */
const STOP_REACH_M = 500;
const STOPS = 2;
/** Departures that left this long ago are gone. */
const GONE_MS = 30_000;

const ICON: Record<ModeGroup, LucideIcon> = { bus: BusFront, tram: TramFront, metro: TrainFrontTunnel, rail: TrainFront, ferry: Ship, other: Navigation };

/** A square around `at`, `r` metres from the centre to each side. */
function around(at: LatLon, r: number): { west: number; south: number; east: number; north: number } {
  const dLat = r / 111_320;
  const dLon = r / (111_320 * Math.cos((at.lat * Math.PI) / 180));
  return { west: at.lon - dLon, south: at.lat - dLat, east: at.lon + dLon, north: at.lat + dLat };
}

/** The nearest stops, one per name: the two platforms of a stop share it. */
export function nearestStops(stops: readonly TransitStop[], at: LatLon, radiusM: number, n = STOPS): TransitStop[] {
  const names = new Set<string>();
  const out: TransitStop[] = [];
  for (const { s } of stops.map((s) => ({ s, d: distanceM(at, s) })).filter((x) => x.d <= radiusM).sort((a, b) => a.d - b.d)) {
    if (names.has(s.name)) continue;
    names.add(s.name);
    out.push(s);
    if (out.length === n) break;
  }
  return out;
}

/** One item per stop: its next departure, then the lines that follow. Null when nothing leaves soon. */
export function stopItem(stop: TransitStop, board: Board, now: number): NearbyItem | null {
  const next = board.departures.filter((d) => !d.cancelled && d.time >= now - GONE_MS).sort((a, b) => a.time - b.time);
  const first = next[0];
  if (!first) return null;
  const then = [...new Set(next.slice(1).map((d) => d.route))].filter((r) => r !== first.route).slice(0, 3);
  const entity = { kind: "stop", id: stop.stopId, data: stop } as const;
  return {
    id: stop.stopId,
    title: `Stop · ${stop.name}`,
    detail: `${first.route} to ${first.headsign}${then.length ? `, then ${then.join(", ")}` : ""}`,
    kind: "go",
    at: { lat: stop.lat, lon: stop.lon },
    icon: Signpost,
    tone: "fog",
    live: false,
    startsAt: first.time,
    entity,
    primary: { label: "Departures", run: () => profile.open(entity) },
    more: [{ label: "Walk there", run: () => import("../city/client").then((m) => m.routeTo({ lat: stop.lat, lon: stop.lon, name: stop.name }, "foot")) }],
  };
}

/** Nearby vehicles need a measured fix; a matched route can forecast from that moment. */
export function vehicleItems(trips: readonly TripSegment[], at: LatLon, radiusM: number, now: number): NearbyItem[] {
  const seen = new Set<string>();
  return trips.flatMap((trip): NearbyItem[] => {
    const fix = trip.fix;
    const p = positionAt(trip, now);
    const id = vehicleKey(trip);
    if (!fix || fix.at <= 0 || !p || distanceM(at, p) > radiusM || seen.has(id)) return [];
    seen.add(id);
    const entity = { kind: "vehicle", id, data: trip } as const;
    const group = modeGroup(trip.mode);
    return [{
      id,
      title: `${MODE_LABEL[group]} ${trip.route || fix.label || trip.tripId}`,
      detail: [trip.to && `To ${trip.to.name}`, fix.label && `Vehicle ${fix.label}`, `${p.quality === "last-known" ? "Last known" : p.estimated ? "Estimated" : "Reported"} · GPS ${fmt.ago(fix.at, now)}`, trip.occupancy && OCCUPANCY_TEXT[trip.occupancy]].filter(Boolean).join(" · "),
      kind: "go", at: { lat: p.lat, lon: p.lon }, icon: ICON[group], tone: "sodium", live: p.quality === "reported" || p.quality === "estimated",
      until: fix.at + FIX_MAX_AGE_MS,
      entity,
      primary: { label: "View vehicle", run: () => profile.open(entity) },
    }];
  });
}

/** Reuses the map's fused vehicle identity, route forecast and GPS expiry. */
export const nearbyVehicles: NearbyProvider = async ({ at, radiusM }, signal) => {
  const { vehicles } = await fetchTrips(around(at, radiusM), 16, signal);
  return vehicleItems(vehicles, at, radiusM, transitNow());
};

/** Departures from the nearest stops. Stops come from the hour-long stop cache; each board is cached for 20 s on the server. */
const nearby: NearbyProvider = async ({ at, radiusM, now }, signal) => {
  const reach = Math.min(radiusM, STOP_REACH_M);
  const stops = nearestStops(await fetchStops(around(at, reach), signal), at, reach);
  const boards = await Promise.allSettled(stops.map((s) => fetchBoard(s.stopId, signal)));
  // A board that failed leaves its stop out; only when every board failed is there nothing to say.
  const failure = boards.find((b): b is PromiseRejectedResult => b.status === "rejected");
  if (failure && boards.every((b) => b.status === "rejected")) throw failure.reason;
  return stops.flatMap((s, i) => {
    const board = boards[i];
    const item = board?.status === "fulfilled" ? stopItem(s, board.value, now) : null;
    return item ? [item] : [];
  });
};
export default nearby;
