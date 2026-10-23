import type { MapView } from "../city/extension";
import type { Aircraft } from "./types";

/** Inside the view or within a poll's flight of it (about 0.05°, 5 km). A view across ±180° has `east` past 180 or `west` below -180. */
export function nearView(a: Pick<Aircraft, "lat" | "lon">, view: Pick<MapView, "west" | "south" | "east" | "north">): boolean {
  const pad = 0.05;
  if (a.lat < view.south - pad || a.lat > view.north + pad) return false;
  const span = view.east - view.west + 2 * pad;
  if (span >= 360) return true;
  const fromWest = (((a.lon - (view.west - pad)) % 360) + 360) % 360;
  return fromWest <= span;
}
