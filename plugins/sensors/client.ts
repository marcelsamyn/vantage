import { api, qs } from "../../app/core/api";
import type { LatLon } from "../../shared/geo";
import type { Sensor, SensorHistory, SensorKind, SensorLevel, SensorsNear, StreetReport } from "./types";

export const fetchSensors = (kind: SensorKind, at: LatLon, radiusKm: number, signal?: AbortSignal): Promise<SensorsNear> =>
  api<SensorsNear>(qs("/api/sensors/near", { kind, lat: at.lat.toFixed(3), lon: at.lon.toFixed(3), radiusKm: Math.round(radiusKm) }), { signal });

export const fetchStreet = (at: LatLon, signal?: AbortSignal): Promise<StreetReport> => api<StreetReport>(qs("/api/sensors/street", { lat: at.lat.toFixed(3), lon: at.lon.toFixed(3) }), { signal });

export const fetchHistory = (key: string, signal?: AbortSignal): Promise<SensorHistory> => api<SensorHistory>(qs("/api/sensors/history", { key }), { signal });

/** The colour that goes with a level: the kernel's fixed meanings (mint is fine, sodium is a live signal that deserves attention, alarm is danger). */
export const LEVEL_TONE: Record<SensorLevel, "mint" | "sodium" | "alarm"> = { fine: "mint", elevated: "sodium", high: "alarm" };

export const LEVEL_WORD: Record<SensorLevel, string> = { fine: "Normal", elevated: "Elevated", high: "High" };

/** Value as shown on screen: PM and noise with one decimal, radiation with two. */
export function showValue(s: Pick<Sensor, "kind" | "value">): string {
  if (s.kind === "radiation") return s.value.toFixed(2);
  return s.value >= 100 ? String(Math.round(s.value)) : s.value.toFixed(1);
}
