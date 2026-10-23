/** Payloads served by /api/ships: vessels that broadcast their position over AIS. */

export type ShipCategory = "cargo" | "tanker" | "passenger" | "fishing" | "pleasure" | "other";

export interface Vessel {
  mmsi: number;
  name: string | null;
  lat: number;
  lon: number;
  sogKt: number | null;
  cogDeg: number | null;
  headingDeg: number | null;
  navStatus: number | null;
  /** AIS ship-type code 0–99, when the vessel has sent its static data. */
  shipType: number | null;
  category: ShipCategory;
  flag: string | null;
  /** When the position was reported, epoch milliseconds. */
  at: number;
  source: "digitraffic" | "kystverket" | "aisstream";
  reportKind?: "sar-aircraft";
  altitudeM?: number | null;
}

export interface ShipsNear {
  fetchedAt: number;
  vessels: Vessel[];
  sources: ShipSource[];
}

export interface ShipSource {
  id: "digitraffic" | "kystverket" | "aisstream";
  name: string;
  /** "idle" means the view lies outside the waters the source covers, so it was not asked. */
  state: "ok" | "idle" | "connecting" | "unreachable" | "unconfigured";
  compressed?: boolean;
  count: number;
  error?: string;
}

export interface ShipSafetyReport {
  text: string;
  at: number;
  recipientMmsi?: number;
}

export interface ShipDetails extends Vessel {
  safetyReports?: ShipSafetyReport[];
  callSign: string | null;
  imo: number | null;
  destination: string | null;
  /** Estimated arrival, epoch ms, or null when the vessel has not set it. */
  etaMs: number | null;
  draughtM: number | null;
  lengthM: number | null;
  beamM: number | null;
}

declare module "../../app/core/plugin" {
  interface EntityKinds {
    ship: Vessel;
  }
}
