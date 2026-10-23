import { api, qs } from "../../app/core/api";
import type { Units } from "../../app/core/settings";
import type { ArgoFloat, ArgoProfile, Gauge, GaugeAlerts, GaugeReading, SeaLevel } from "./types";

export interface Box {
  west: number;
  south: number;
  east: number;
  north: number;
}

const boxQuery = (box: Box): Record<string, string> => ({ west: box.west.toFixed(2), south: box.south.toFixed(2), east: box.east.toFixed(2), north: box.north.toFixed(2) });

/** Gauges in a box. With `analyse`, the gauges nearest the box centre also carry their current level. */
export const fetchGauges = (box: Box, analyse: boolean, signal?: AbortSignal): Promise<Gauge[]> =>
  api<Gauge[]>(qs("/api/sea/gauges", { ...boxQuery(box), analyse: analyse ? "1" : "0" }), { signal });

export const fetchGauge = (code: string, signal?: AbortSignal): Promise<GaugeReading> => api<GaugeReading>(qs("/api/sea/gauge", { code }), { signal });

export const fetchAlerts = (at: { lat: number; lon: number }, signal?: AbortSignal): Promise<GaugeAlerts> =>
  api<GaugeAlerts>(qs("/api/sea/alerts", { lat: at.lat.toFixed(3), lon: at.lon.toFixed(3), radiusKm: 300 }), { signal });

export const fetchArgo = (box: Box, signal?: AbortSignal): Promise<ArgoFloat[]> => api<ArgoFloat[]>(qs("/api/sea/argo", boxQuery(box)), { signal });

export const fetchArgoProfile = (platform: string, signal?: AbortSignal): Promise<ArgoProfile> => api<ArgoProfile>(qs("/api/sea/argo/profile", { platform }), { signal });

export const LEVEL_NAME: Record<SeaLevel, string> = { normal: "Normal for this gauge", restless: "Restless", unusual: "Unusual" };
export const LEVEL_TONE: Record<SeaLevel, "mint" | "sodium" | "alarm"> = { normal: "mint", restless: "sodium", unusual: "alarm" };

/** A small height for people: centimetres under a metre, metres above; inches and feet for imperial. */
export function height(m: number, units: Units): string {
  if (units === "imperial") {
    const inches = m * 39.3701;
    return Math.abs(inches) < 24 ? `${Math.round(inches)} in` : `${(m * 3.28084).toFixed(1)} ft`;
  }
  return Math.abs(m) < 1 ? `${Math.round(m * 100)} cm` : `${m.toFixed(2)} m`;
}

/** "every minute", "every 5 minutes", "every 15 seconds". */
export function every(intervalMin: number): string {
  if (intervalMin < 0.99) return `every ${Math.round(intervalMin * 60)} seconds`;
  const m = Math.round(intervalMin);
  return m === 1 ? "every minute" : `every ${m} minutes`;
}

/** Water temperature with `places` decimals, in the viewer's unit. */
export function temperature(c: number, units: Units, places = 1): string {
  return units === "imperial" ? `${((c * 9) / 5 + 32).toFixed(places)}°F` : `${c.toFixed(places)}°C`;
}

/** Depth for people. Argo measures pressure in decibars, which is within 1% of metres of depth. */
export function depth(dbar: number, units: Units): string {
  return units === "imperial" ? `${Math.round(dbar * 3.28084).toLocaleString("en-US")} ft` : `${Math.round(dbar).toLocaleString("en-US")} m`;
}
