import { api, qs } from "../../app/core/api";
import { usePoll, type Polled } from "../../app/core/hooks";
import type { LatLon } from "../../shared/geo";
import type { Facts, Heritage, Nasoni, Parking, StreetEnergy, Tenders, TreeTile, Trees, WifiDay } from "./types";

type FactRoute = "heritage" | "energy" | "trees" | "parking";
interface FactPayload {
  heritage: Heritage | null;
  energy: StreetEnergy | null;
  trees: Trees | null;
  parking: Parking | null;
}

/** What one register knows about a spot. `null` means the register has nothing there, which is not an error. */
export function usePlaceFact<R extends FactRoute>(route: R, at: LatLon): Polled<FactPayload[R]> {
  return usePoll((signal) => api<FactPayload[R]>(qs(`/api/dossier/${route}`, { lat: at.lat, lon: at.lon }), { signal }), null, [route, at.lat, at.lon]);
}

export const fetchNasoni = (signal?: AbortSignal): Promise<Nasoni> => api<Nasoni>("/api/dossier/nasoni", { signal });
export const fetchWifiDay = (signal?: AbortSignal): Promise<WifiDay> => api<WifiDay>("/api/dossier/wifi", { signal });
export const fetchRemarkableTrees = (signal?: AbortSignal): Promise<TreeTile> => api<TreeTile>("/api/dossier/trees/remarkable", { signal });
export const fetchTreeTile = (x: number, y: number, signal?: AbortSignal): Promise<TreeTile> => api<TreeTile>(qs("/api/dossier/trees/tile", { x, y }), { signal });
export const fetchFacts = (at: LatLon, signal?: AbortSignal): Promise<Facts> => api<Facts>(qs("/api/dossier/facts", { lat: at.lat, lon: at.lon }), { signal });

/** The contract notices of the city around a spot, or `null` where no city is named. The spot is rounded to about 50 m so a drifting position reuses the answer. */
export function useCityTenders(at: LatLon | null): Polled<Tenders | null> {
  const lat = at ? Math.round(at.lat * 2000) / 2000 : null;
  const lon = at ? Math.round(at.lon * 2000) / 2000 : null;
  return usePoll((signal) => api<Tenders | null>(qs("/api/dossier/tenders", { lat, lon }), { signal }), 30 * 60_000, [lat, lon], at === null);
}
