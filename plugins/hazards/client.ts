import { api, qs } from "../../app/core/api";
import type { Disaster, EonetCategory, EonetEvent, Quake, SeismoTrace, VolcanoSeismo } from "./types";

export const fetchQuakes = (window: "day" | "week" | "month", signal?: AbortSignal): Promise<Quake[]> => api<Quake[]>(`/api/hazards/quakes?window=${window}`, { signal });
export const fetchDisasters = (signal?: AbortSignal): Promise<Disaster[]> => api<Disaster[]>("/api/hazards/disasters", { signal });

/** Ten minutes of ground motion at the station nearest a place. With `at` (epoch ms), the window starts a minute before that moment. */
export const fetchSeismo = (at: { lat: number; lon: number }, moment?: number, signal?: AbortSignal): Promise<SeismoTrace> =>
  api<SeismoTrace>(qs("/api/hazards/seismo", { lat: at.lat.toFixed(3), lon: at.lon.toFixed(3), at: moment }), { signal });

/** Ten minutes of ground motion at Etna, Stromboli and Campi Flegrei. With `moment` (epoch ms), the window starts a minute before it. */
export const fetchVolcanoes = (moment?: number, signal?: AbortSignal): Promise<VolcanoSeismo[]> => api<VolcanoSeismo[]>(qs("/api/hazards/volcanoes", { at: moment }), { signal });

export const fetchEvents = (box: { west: number; south: number; east: number; north: number }, signal?: AbortSignal): Promise<EonetEvent[]> =>
  api<EonetEvent[]>(qs("/api/hazards/events", { west: box.west.toFixed(2), south: box.south.toFixed(2), east: box.east.toFixed(2), north: box.north.toFixed(2) }), { signal });

/** Seismic energy as tonnes of TNT: E = 10^(1.5·M + 4.8) joules; one tonne of TNT is 4.184 GJ. */
export function tntTonnes(mag: number): number {
  return 10 ** (1.5 * mag + 4.8) / 4.184e9;
}

export const DISASTER_NAME: Record<Disaster["type"], string> = {
  EQ: "Earthquake",
  TC: "Tropical cyclone",
  FL: "Flood",
  VO: "Volcanic eruption",
  WF: "Wildfire",
  DR: "Drought",
};

export const EONET_NAME: Record<EonetCategory, string> = {
  wildfires: "Wildfire",
  severeStorms: "Severe storm",
  volcanoes: "Volcano",
  seaLakeIce: "Sea and lake ice",
  floods: "Flood",
  dustHaze: "Dust and haze",
  drought: "Drought",
  landslides: "Landslide",
  snow: "Snow",
  tempExtremes: "Temperature extreme",
  waterColor: "Water colour",
  manmade: "Human-made event",
  earthquakes: "Earthquake",
};

/** What a ground-velocity reading means in plain words. Quiet city ground moves a few hundred nm/s from traffic and ocean waves. */
export function groundMotion(peakNmS: number): { label: string; tone: "mint" | "sodium" | "alarm" } {
  if (peakNmS < 2_000) return { label: "Quiet: only traffic, wind and distant ocean waves", tone: "mint" };
  if (peakNmS < 20_000) return { label: "Small shaking, such as a passing lorry or a faraway quake", tone: "sodium" };
  return { label: "Strong shaking: a nearby quake or heavy machinery next to the sensor", tone: "alarm" };
}

/** Velocity for people: nm/s up to a few thousand, then µm/s and mm/s. */
export function formatVelocity(nmPerS: number): string {
  if (nmPerS < 1000) return `${Math.round(nmPerS)} nm/s`;
  if (nmPerS < 1_000_000) return `${(nmPerS / 1000).toFixed(nmPerS < 10_000 ? 1 : 0)} µm/s`;
  return `${(nmPerS / 1_000_000).toFixed(1)} mm/s`;
}
