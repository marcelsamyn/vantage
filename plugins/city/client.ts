import { api, errorMessage, qs } from "../../app/core/api";
import { feed } from "../../app/core/feed";
import { useLocation } from "../../app/core/location";
import { go } from "../../app/core/nav";
import type { LatLon } from "../../shared/geo";
import { useCity } from "./store";
import type { Route, Structure, TravelMode, WhatsHere } from "./types";

/** Public client for the City plugin: other plugins can ask for routes or a "what's here" lookup. */

export function fetchWhatsHere(at: LatLon, signal?: AbortSignal): Promise<WhatsHere> {
  return api<WhatsHere>(qs("/api/city/whatshere", { lat: at.lat, lon: at.lon }), { signal });
}

/** The building or landmark standing at a point, from OpenStreetMap. Slower than `fetchWhatsHere`. */
export function fetchStructure(at: LatLon, signal?: AbortSignal): Promise<Structure | null> {
  return api<Structure | null>(qs("/api/city/structure", { lat: at.lat, lon: at.lon }), { signal });
}

/** Switch a map layer on and open the City screen, e.g. from a "Show on map" button. */
export function showLayer(layerId: string): void {
  useCity.getState().toggle(layerId, true);
  go("city");
}

const MODE_LABEL: Record<TravelMode, string> = { foot: "walking", bike: "cycling", car: "driving" };

/** Plan a route from where you are to `to`, show it on the City map and switch to it. */
export async function routeTo(to: LatLon & { name?: string }, mode: TravelMode): Promise<void> {
  const here = useLocation.getState().here;
  if (!here) {
    feed({ level: "alert", source: "city", title: "Route needs your location", detail: "Allow location or pin a place first." }, { toast: true });
    return;
  }
  try {
    const route = await api<Route>(qs("/api/city/route", { fromLat: here.lat, fromLon: here.lon, toLat: to.lat, toLon: to.lon, mode }));
    useCity.getState().setRoute(route);
    go("city");
  } catch (err) {
    feed({ level: "alert", source: "city", title: `No ${MODE_LABEL[mode]} route${to.name ? ` to ${to.name}` : ""}`, detail: errorMessage(err) }, { toast: true });
  }
}
