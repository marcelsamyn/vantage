import { bearingDeg, compassPoint, distanceM } from "../../shared/geo";
import type { Meteor } from "./types";

/** Plain-words facts about one meteor, worked out from the numbers the Global Meteor Network publishes. */

/** How far it travelled through the air, in km: the ground track and the drop in height together. */
export function trackKm(m: Meteor): number {
  const ground = distanceM(m.begin, m.end) / 1000;
  return Math.hypot(ground, m.begin.heightKm - m.end.heightKm);
}

/** The compass point it was heading towards, from its ground track. Null when the track is too short to tell. */
export function headingOf(m: Meteor): string | null {
  return distanceM(m.begin, m.end) < 500 ? null : compassPoint(bearingDeg(m.begin, m.end));
}

export const kmh = (kms: number): number => Math.round(kms * 3600);

/** "2.7 mg" or "5.9 g". The mass is an estimate from how much light the meteor gave off. */
export function massText(kg: number): string {
  const mg = kg * 1e6;
  if (mg < 1000) return `${mg < 10 ? mg.toFixed(1) : Math.round(mg)} mg`;
  const g = mg / 1000;
  return `${g < 10 ? g.toFixed(1) : Math.round(g)} g`;
}

/** The mass as something you have held. */
export function massComparison(kg: number): string {
  const g = kg * 1000;
  if (g < 0.005) return "a grain of sand";
  if (g < 0.05) return "a grain of rice";
  if (g < 0.5) return "a few grains of rice";
  if (g < 2) return "a paperclip";
  if (g < 12) return "a coin";
  return "a small pebble";
}

/** Peak brightness against things in the sky, as a clause. Absolute magnitude is how bright it would look from 100 km away. */
export function brightnessNote(mag: number): string {
  if (mag <= -4) return "was a fireball, brighter than Venus would look from 100 km away";
  if (mag <= -1.5) return "outshone Sirius, the brightest star, as seen from 100 km away";
  if (mag <= 0) return "matched the brightest stars as seen from 100 km away";
  if (mag <= 3) return "was as bright as a visible star from 100 km away";
  return "was faint, easy to miss with the naked eye";
}

export const showerLabel = (m: Meteor): string => m.showerName ?? (m.shower ? `Shower ${m.shower}` : "Sporadic meteor");

/** Height above the ground where a meteor lit up, as colour stops [km, colour]. The map layer and its legend share them. */
export const HEIGHT_STOPS = [
  [75, "#ffb547"],
  [95, "#e6ecf0"],
  [115, "#82e4ff"],
] as const;
