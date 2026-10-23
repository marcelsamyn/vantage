import * as SunCalc from "suncalc";
import { create } from "zustand";
import { api, qs } from "../../app/core/api";
import { usePoll } from "../../app/core/hooks";
import { distanceM, type LatLon } from "../../shared/geo";
import type { Place } from "../../shared/location";
import type { AsteroidsInfo, AuroraGrid, AuroraPoint, Fireball, KpInfo, KpSlot, Shields, SpaceWeatherNow } from "./types";

/** Latest space weather, the aurora chance and Earth's shields at your location, kept fresh by the space weather watcher. */
export const useSpaceWx = create<{ now: SpaceWeatherNow | null; aurora: AuroraPoint | null; shields: Shields | null; error: string | null }>(() => ({ now: null, aurora: null, shields: null, error: null }));

export const fetchNow = (signal?: AbortSignal): Promise<SpaceWeatherNow> => api<SpaceWeatherNow>("/api/spacewx/now", { signal });
export const fetchAuroraAt = (at: LatLon, signal?: AbortSignal): Promise<AuroraPoint> => api<AuroraPoint>(qs("/api/spacewx/aurora", { lat: at.lat.toFixed(2), lon: at.lon.toFixed(2) }), { signal });
export const fetchAuroraGrid = (signal?: AbortSignal): Promise<AuroraGrid> => api<AuroraGrid>("/api/spacewx/aurora/grid", { signal });
export const fetchShields = (at: LatLon, signal?: AbortSignal): Promise<Shields> => api<Shields>(qs("/api/spacewx/shields", { lat: at.lat.toFixed(2), lon: at.lon.toFixed(2) }), { signal });
export const fetchAsteroids = (signal?: AbortSignal): Promise<AsteroidsInfo> => api<AsteroidsInfo>("/api/spacewx/asteroids", { signal });
export const fetchFireballs = (signal?: AbortSignal): Promise<Fireball[]> => api<Fireball[]>("/api/spacewx/fireballs", { signal });

/** NOAA's own words for each G-scale storm level. */
const STORM_WORDS = ["", "Minor storm", "Moderate storm", "Strong storm", "Severe storm", "Extreme storm"] as const;

/** Plain description of geomagnetic activity from its G-scale level and Kp. */
export function activityWords(scale: number, kp: number): string {
  if (scale > 0) return STORM_WORDS[Math.min(5, scale)] ?? "Storm";
  if (kp < 3) return "Quiet";
  if (kp < 4) return "Unsettled";
  return "Active";
}

/** What a storm of this level does, after NOAA's G-scale descriptions. Latitudes are geomagnetic, not geographic. */
export function stormEffects(scale: number): string {
  switch (scale) {
    case 0:
      return "No storm. Aurora stays near the poles.";
    case 1:
      return "Weak power-grid fluctuations are possible, and aurora is common at high latitudes.";
    case 2:
      return "Long power lines can raise voltage alarms, and aurora can reach about 55° geomagnetic latitude.";
    case 3:
      return "Satellite navigation may be intermittent, and aurora can reach about 50° geomagnetic latitude.";
    case 4:
      return "Grid problems and radio trouble are possible, and aurora can reach about 45° geomagnetic latitude.";
    default:
      return "Power grids and satellites can be disrupted, and aurora can reach about 40° geomagnetic latitude.";
  }
}

/** True when the Sun is more than 12° below the horizon: full darkness, as aurora watching needs. */
export function isDark(at: LatLon, date = new Date()): boolean {
  return SunCalc.getPosition(date, at.lat, at.lon).altitude < -12;
}

/** Sun elevation in degrees. */
export function sunElevation(at: LatLon, date = new Date()): number {
  return SunCalc.getPosition(date, at.lat, at.lon).altitude;
}

export interface AuroraField {
  width: number;
  height: number;
  cells: Uint8Array;
}

export function decodeGrid(grid: AuroraGrid): AuroraField {
  const bin = atob(grid.cells);
  const cells = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) cells[i] = bin.charCodeAt(i);
  return { width: grid.width, height: grid.height, cells };
}

/** Aurora probability (percent) at a point, interpolated between grid cells. Longitude wraps. */
export function sampleField(field: AuroraField, lat: number, lon: number): number {
  const { width, height, cells } = field;
  const y = Math.max(0, Math.min(height - 1, lat + 90));
  const x = ((lon % 360) + 360) % 360;
  const y0 = Math.floor(y);
  const y1 = Math.min(height - 1, y0 + 1);
  const x0 = Math.floor(x) % width;
  const x1 = (x0 + 1) % width;
  const fy = y - y0;
  const fx = x - Math.floor(x);
  const at = (r: number, c: number): number => cells[r * width + c] ?? 0;
  return (at(y0, x0) * (1 - fx) + at(y0, x1) * fx) * (1 - fy) + (at(y1, x0) * (1 - fx) + at(y1, x1) * fx) * fy;
}

/**
 * Colour and opacity for an aurora probability: clear below a few percent, a soft mint glow that
 * brightens toward white as the chance rises. Returns RGBA bytes.
 */
export function auroraRgba(percent: number): [number, number, number, number] {
  const t = Math.min(1, Math.max(0, (percent - 1.5) / 30));
  const alpha = t * t * (3 - 2 * t) * 0.82;
  const glow = Math.min(1, percent / 70);
  return [111 + (230 - 111) * glow, 242 + (236 - 242) * glow, 180 + (240 - 180) * glow, alpha * 255];
}

/** Highest Kp the NOAA forecast shows for the next `hours` hours, with its block start. */
export function peakAhead(kp: KpInfo, now: number, hours = 24): KpSlot | null {
  let best: KpSlot | null = null;
  for (const s of kp.slots) {
    if (s.at + 3 * 3_600_000 <= now || s.at > now + hours * 3_600_000) continue;
    if (!best || s.kp > best.kp) best = s;
  }
  return best;
}

export interface Reach {
  /** Latitude the aurora can be seen down to, signed; null when the oval is too weak near your longitude. */
  lat: number | null;
  /** The place at that latitude on your meridian, when it is on land. */
  place: Place | null;
  /** Distance from you to that latitude, metres. Zero when aurora reaches you. */
  distanceM: number | null;
  /** True when the aurora can be seen from where you are. */
  reachesYou: boolean;
}

/** How far toward the equator the aurora can be seen from your meridian right now, and where that is. */
export function useReach(here: LatLon, aurora: AuroraPoint): Reach {
  const lat = aurora.reachLat;
  const reachesYou = lat !== null && Math.abs(lat) <= Math.abs(here.lat);
  const key = lat === null || reachesYou ? null : `${Math.round(lat)},${Math.round(here.lon)}`;
  const place = usePoll((signal) => api<Place | null>(qs("/api/core/reverse", { lat: Math.round(lat ?? 0), lon: Math.round(here.lon) }), { signal }), null, [key], key === null);
  return {
    lat,
    place: key === null ? null : (place.data ?? null),
    distanceM: lat === null ? null : reachesYou ? 0 : distanceM(here, { lat, lon: here.lon }),
    reachesYou,
  };
}
