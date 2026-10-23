import { stampVehicles, vehicleFeed } from "./feeds.server";
import { decodeFeed, type RtVehicle } from "./gtfsrt";
import { fetchBytes } from "./http.server";
import type { VehicleReport } from "./types";

/** Roma Servizi per la Mobilità publishes ATAC's real-time feeds as open data for traveller information. */
export const ROME_SOURCE = "ATAC via Roma Servizi per la Mobilità (open data AVM)";
const BASE = "https://romamobilita.it/sites/default/files/";
const VEHICLES = `${BASE}rome_rtgtfs_vehicle_positions_feed.pb`;
export const ROME_PROBE = VEHICLES;

/** Transitous trip ids for Rome end in the ATAC trip id: "20261008_22:50_it-Lazio-Rome_0#910-9". */
const TRANSITOUS_ROME_TRIP = /^\d{8}_\d{2}:\d{2}_it-Lazio-Rome_(.+)$/;

/** The ATAC trip id inside a Transitous trip id, or null when the trip is not a Rome one. */
export function atacTripId(transitousTripId: string): string | null {
  if (transitousTripId.startsWith("atac:")) return transitousTripId.slice(5);
  return TRANSITOUS_ROME_TRIP.exec(transitousTripId)?.[1] ?? null;
}

/** Every vehicle ATAC reports right now, preserving physical labels. The feed refreshes about every 10 s. */
export function romeVehicles(): Promise<RtVehicle[]> {
  return vehicleFeed("atac", "transit:rome:vehicles", 10_000, async () => {
    const feed = decodeFeed(await fetchBytes("Roma Mobilità vehicle positions", VEHICLES));
    return stampVehicles(feed);
  });
}

/** Physical descriptor ids remain separate from passenger-facing fleet labels. */
export function romeReports(vehicles: readonly RtVehicle[]): VehicleReport[] {
  return vehicles.map((v): VehicleReport => ({
    scope: "it-Lazio-Rome", source: "atac", id: v.vehicleId || v.label || v.id,
    identity: v.vehicleId || v.label ? "vehicle" : "trip",
    tripId: v.tripId, route: v.routeId, mode: "OTHER", stopId: v.stopId, delayMin: null, occupancy: v.occupancy,
    fix: { lon: v.lon, lat: v.lat, at: v.timestamp * 1000, receivedAt: v.receivedAt, producedAt: v.producedAt, feed: ROME_SOURCE, label: v.label, tripId: v.tripId, bearing: v.bearing, speedMs: v.speedMs, evidence: "gps", serviceDate: v.serviceDate, startTime: v.startTime, stopSequence: v.stopSequence, stopStatus: v.stopStatus },
  }));
}
