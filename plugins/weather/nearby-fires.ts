import { Flame } from "lucide-react";
import type { NearbyItem, NearbyProvider } from "../../app/core/nearby";
import { distanceM, type LatLon } from "../../shared/geo";
import { fetchFires } from "./client";
import type { FireSpots } from "./types";

const SHOWN = 3;
/** The server keeps the newest frame when the satellite feed stalls; a picture this old says nothing about now. */
const STALE_MS = 3 * 3_600_000;

/** The nearest hot spots Meteosat sees inside the radius. A spot can be a wildfire, a gas flare or a volcano. */
export function fireItems(data: FireSpots, at: LatLon, radiusM: number, now: number): NearbyItem[] {
  if (now - Date.parse(data.time) > STALE_MS) return [];
  return data.spots
    .map((s) => ({ s, d: distanceM(at, s) }))
    .filter((x) => x.d <= radiusM)
    .sort((a, b) => a.d - b.d)
    .slice(0, SHOWN)
    .map(
      ({ s }): NearbyItem => ({
        id: `${s.lat.toFixed(3)},${s.lon.toFixed(3)}`,
        title: "Hot spot seen from space",
        detail: "Fire, gas flare or volcano, seen by Meteosat",
        kind: "see",
        at: { lat: s.lat, lon: s.lon },
        icon: Flame,
        tone: "alarm",
        primary: { label: "Show on map", run: () => import("../city/client").then((m) => m.showLayer("weather.fires")) },
      }),
    );
}

/** The server refreshes the satellite frame every ten minutes, like the fire layer. */
const nearby: NearbyProvider = async ({ at, radiusM, now }, signal) => fireItems(await fetchFires(signal), at, radiusM, now);
export default nearby;
