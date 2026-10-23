import type { LatLon } from "../../shared/geo";
import type { Drone, DroneSnapshot, OperatorLocationType } from "./types";

export const SETUP_MESSAGE = "No receiver answered at orecchino.local. Power on your Orecchino receiver on this network; setup is in plugins/drones/orecchino/README.md. To use another receiver, set VANTAGE_DRONE_RECEIVER_URL to its feed URL, for example http://pi:8754/data/remoteid.json, then restart VANTAGE.";
export const MAX_REPORT_AGE_MS = 60_000;
const MAX_SNAPSHOT_AGE_MS = 10_000;

export function receiverProblem(snapshot: DroneSnapshot | undefined, now: number): string | null {
  if (!snapshot) return null;
  if (snapshot.state === "setup") return SETUP_MESSAGE;
  if (snapshot.receiverAt === null || Math.abs(snapshot.fetchedAt - snapshot.receiverAt) > MAX_SNAPSHOT_AGE_MS || now - snapshot.fetchedAt > MAX_SNAPSHOT_AGE_MS) {
    return "Receiver snapshot is old or its clock is out of sync. Check that the receiver is running and its clock is set.";
  }
  return null;
}

export function recentDrones(snapshot: DroneSnapshot | undefined, now: number): Drone[] {
  if (!snapshot || receiverProblem(snapshot, now)) return [];
  return snapshot.drones.filter((v) => now - v.reportedAt < MAX_REPORT_AGE_MS);
}

export function hasRecentPosition(drone: Drone, now: number): drone is Drone & { position: LatLon; positionAt: number } {
  return drone.position !== null && drone.positionAt !== null && now - drone.positionAt < MAX_REPORT_AGE_MS && now - drone.reportedAt < MAX_REPORT_AGE_MS;
}

export function operatorLabel(type: OperatorLocationType | null): string {
  switch (type) {
    case "takeoff": return "Launch point";
    case "live_gnss": return "Operator GNSS position";
    case "fixed": return "Fixed operator position";
    case null: return "Operator broadcast position";
  }
}
