import { go } from "../../app/core/nav";

/** Fly the City map to a fixed spot. Used by palette commands, which must not call go() from plugin.ts. */
export function flyTo(lat: number, lon: number, zoom: number): void {
  go("city", { action: "fly", arg: `${lat},${lon},${zoom}` });
}
