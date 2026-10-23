import type { ArgoLevel } from "./types";

/** Reading a dive. Pure functions shared by the profile card and the chart. */

export interface Cooling {
  fromDbar: number;
  toDbar: number;
  fromC: number;
  toC: number;
}

/** The depth band, 100 decibars deep, over which the water cools fastest: the thermocline. Null when no band cools by at least a degree. */
export function steepestCooling(levels: readonly ArgoLevel[]): Cooling | null {
  let best: (Cooling & { drop: number }) | null = null;
  for (let i = 0; i < levels.length; i++) {
    const a = levels[i];
    if (!a) continue;
    // A 100 dbar span smooths the sensor's fine steps.
    const b = levels.find((l, j) => j > i && l.presDbar >= a.presDbar + 100);
    if (!b) break;
    const drop = a.tempC - b.tempC;
    if (!best || drop > best.drop) best = { fromDbar: a.presDbar, toDbar: b.presDbar, fromC: a.tempC, toC: b.tempC, drop };
  }
  return best && best.drop >= 1 ? best : null;
}

/** The measured level closest to `dbar`, if one lies within `within` decibars of it. */
export function levelNear(levels: readonly ArgoLevel[], dbar: number, within: number): ArgoLevel | null {
  const nearest = levels.reduce<ArgoLevel | null>((best, l) => (best === null || Math.abs(l.presDbar - dbar) < Math.abs(best.presDbar - dbar) ? l : best), null);
  return nearest && Math.abs(nearest.presDbar - dbar) <= within ? nearest : null;
}

/** Whether a point lies in the Mediterranean, where the deep water stays warm (about 13 °C) because the shallow Strait of Gibraltar keeps out the cold Atlantic bottom water. */
export function inMediterranean(lat: number, lon: number): boolean {
  return lat >= 30 && lat <= 46 && lon >= -6 && lon <= 37;
}
