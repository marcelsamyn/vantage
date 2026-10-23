import { create } from "zustand";
import { api, qs } from "../../app/core/api";
import { usePoll } from "../../app/core/hooks";
import { destination, type LatLon } from "../../shared/geo";
import type { Loiter } from "./loiter";
import type { Aircraft, AircraftDetails, AircraftPhoto, AircraftSnapshot, WorldwideSnapshot } from "./types";

/** Aircraft around you, kept fresh by the aircraft watcher service. Screens and tiles read from here. */
export const useTraffic = create<{ snapshot: AircraftSnapshot | null; error: string | null }>(() => ({ snapshot: null, error: null }));

/** Aircraft squawking 7700, 7600 or 7500 anywhere in the world, kept fresh by the aircraft watcher. */
export const useEmergencies = create<{ snapshot: WorldwideSnapshot | null; error: string | null }>(() => ({ snapshot: null, error: null }));

/** An aircraft near you that is going round in circles, with the path it flew. */
export interface Circling {
  aircraft: Aircraft;
  fetchedAt: number;
  loiter: Loiter;
}

/** Aircraft near you that are circling right now, by transponder address. */
export const useCircling = create<{ byHex: ReadonlyMap<string, Circling> }>(() => ({ byHex: new Map() }));

/** Radius the watcher covers around you, in nautical miles. */
export const AROUND_NM = 40;

export function fetchNear(center: LatLon, radiusNm: number, signal?: AbortSignal): Promise<AircraftSnapshot> {
  return api<AircraftSnapshot>(qs("/api/aircraft/near", { lat: center.lat.toFixed(3), lon: center.lon.toFixed(3), radiusNm: Math.round(radiusNm) }), { signal });
}

export const fetchEmergencies = (signal?: AbortSignal): Promise<WorldwideSnapshot> => api<WorldwideSnapshot>("/api/aircraft/emergencies", { signal });
export const fetchMilitary = (signal?: AbortSignal): Promise<WorldwideSnapshot> => api<WorldwideSnapshot>("/api/aircraft/military", { signal });

export function fetchDetails(a: Pick<Aircraft, "hex" | "callsign">, signal?: AbortSignal): Promise<AircraftDetails> {
  return api<AircraftDetails>(qs("/api/aircraft/details", { hex: a.hex, callsign: a.callsign ?? undefined }), { signal });
}

/**
 * The airframe's photo, or null when no source has one. Call it only for an aircraft on screen: the open profile
 * or a visible list row. The server keeps each answer for a day and the browser for an hour.
 */
export function usePhoto(hex: string): { photo: AircraftPhoto | null; error: Error | null } {
  const { data, error } = usePoll(async (signal) => ({ hex, photo: await api<AircraftPhoto | null>(qs("/api/aircraft/photo", { hex }), { signal }) }), null, [hex]);
  // A row whose aircraft changes keeps the previous answer until the new one arrives; never show one airframe's photo for another.
  return { photo: data?.hex === hex ? data.photo : null, error };
}

/**
 * Dead reckoning: where the aircraft is now, given its last fix, ground speed and track.
 * Positions are a few seconds old when they arrive; projecting them keeps motion smooth between polls.
 */
export function projected(a: Aircraft, fetchedAt: number, now: number): LatLon {
  if (a.onGround || a.speedKt === null || a.trackDeg === null) return a;
  const elapsedS = Math.min(45, (now - fetchedAt) / 1000 + a.posAgeS);
  if (elapsedS <= 0) return a;
  return destination(a, a.trackDeg, a.speedKt * 0.514444 * elapsedS);
}
