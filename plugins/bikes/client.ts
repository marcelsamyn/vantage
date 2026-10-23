import { api, qs } from "../../app/core/api";
import type { LatLon } from "../../shared/geo";
import type { BikesNear, FreeVehicles } from "./types";

export const fetchBikes = (at: LatLon, signal?: AbortSignal): Promise<BikesNear> => api<BikesNear>(qs("/api/bikes/near", { lat: at.lat.toFixed(3), lon: at.lon.toFixed(3) }), { signal });

export const fetchFreeVehicles = (at: LatLon, radiusKm: number, signal?: AbortSignal): Promise<FreeVehicles> =>
  api<FreeVehicles>(qs("/api/bikes/free", { lat: at.lat.toFixed(3), lon: at.lon.toFixed(3), radiusKm: radiusKm.toFixed(1) }), { signal });

export const fetchPricing = (system: string, signal?: AbortSignal): Promise<{ system: string; plans: string[] }> => api<{ system: string; plans: string[] }>(qs("/api/bikes/pricing", { system }), { signal });
