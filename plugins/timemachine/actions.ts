import { go } from "../../app/core/nav";
import type { LatLon } from "../../shared/geo";
import { useTimeMachine } from "./store";
import type { Era } from "./types";

/** Palette commands call these: plugin.ts must not call go() itself. */

export function openTimeMachine(): void {
  useTimeMachine.getState().set({ open: true });
  go("city");
}

/** Open the City map and jump to the earliest map or photo of the spot at its centre. */
export function showOldest(): void {
  useTimeMachine.getState().askForOldest();
  go("city");
}

/** Fly the City map to a spot and lay one era over it. */
export function showEra(era: Era, at: LatLon): void {
  const store = useTimeMachine.getState();
  store.set({ open: true });
  store.pick(era);
  go("city", { action: "fly", arg: `${at.lat},${at.lon},${era.viewZoom}` });
}
