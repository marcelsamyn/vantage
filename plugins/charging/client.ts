import { api, qs } from "../../app/core/api";
import type { ThingBox } from "../../app/core/things";
import { geographicBox } from "../../shared/geo";
import type { ChargingReport } from "./types";
export function fetchCharging(box: ThingBox, signal: AbortSignal): Promise<ChargingReport> {
  return api<ChargingReport>(qs("/api/charging/stations", { ...geographicBox(box) }), { signal });
}
