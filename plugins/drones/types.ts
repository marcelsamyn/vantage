import type { LatLon } from "../../shared/geo";

export type DroneIdType = "serial" | "caa_reg" | "utm_uuid" | "session" | "unknown";
export type OperatorLocationType = "takeoff" | "live_gnss" | "fixed";

export interface DroneOperator {
  position: LatLon | null;
  locationType: OperatorLocationType | null;
  id: string | null;
  takeoffAltitudeM: number | null;
  reportedAt: number | null;
}

export interface Drone {
  id: string;
  idType: DroneIdType;
  aircraftType: string | null;
  position: LatLon | null;
  reportedAt: number;
  positionAt: number | null;
  altitudeM: number | null;
  heightM: number | null;
  speedKt: number | null;
  trackDeg: number | null;
  verticalSpeedMps: number | null;
  rssiDbm: number | null;
  messageCount: number | null;
  transport: string | null;
  transports: string[];
  description: string | null;
  descriptionAt: number | null;
  operator: DroneOperator | null;
}

export interface DroneSnapshot {
  state: "setup" | "ready";
  fetchedAt: number;
  receiverAt: number | null;
  messages: number;
  drones: Drone[];
}

declare module "../../app/core/plugin" {
  interface EntityKinds {
    drone: Drone;
  }
}
