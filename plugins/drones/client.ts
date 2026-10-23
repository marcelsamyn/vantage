import { api } from "../../app/core/api";
import { usePoll, type Polled } from "../../app/core/hooks";
import type { DroneSnapshot } from "./types";

export function fetchDrones(signal?: AbortSignal): Promise<DroneSnapshot> {
  return api<DroneSnapshot>("/api/drones", { signal });
}

export function useDrones(): Polled<DroneSnapshot> {
  return usePoll(fetchDrones, 2000, []);
}
