import { api, qs } from "../../app/core/api";
import { usePoll, type Polled } from "../../app/core/hooks";
import { go } from "../../app/core/nav";
import { profile } from "../../app/core/profile";
import { showLayer } from "../city/client";
import { distanceM } from "../../shared/geo";
import type { BirdsNear, BirdWindow, Meteor, MeteorArea, MeteorDetail, MeteorNight, Microphone, Microphones } from "./types";

/** Public client for the Listen plugin: typed fetchers and hooks for its API. */

export const METEOR_LAYER = "listen.meteors";

export function useMicrophones(): Polled<Microphones> {
  return usePoll((signal) => api<Microphones>("/api/listen/mics", { signal }), 5 * 60_000, []);
}

/** Birds around a place. The server rounds the position to a 0.1° grid, so refetch only when the grid cell changes. */
export function useBirds(at: { lat: number; lon: number } | null, window: BirdWindow, skip = false): Polled<BirdsNear> {
  const cell = at ? `${Math.round(at.lat * 10)},${Math.round(at.lon * 10)}` : null;
  return usePoll((signal) => (at ? api<BirdsNear>(qs("/api/listen/birds", { lat: at.lat, lon: at.lon, window }), { signal }) : Promise.reject(new Error("no location"))), 5 * 60_000, [cell, window], skip || !at);
}

// The Briefing tile, the screen and the map layer all ask for the same night. The file changes once a day, so share the answer.
const METEOR_TTL_MS = 10 * 60_000;
const nights = new Map<MeteorArea, { at: number; load: Promise<MeteorNight> }>();

function fetchNight(area: MeteorArea): Promise<MeteorNight> {
  const hit = nights.get(area);
  if (hit && Date.now() - hit.at < METEOR_TTL_MS) return hit.load;
  const load = api<MeteorNight>(qs("/api/listen/meteors", { area }));
  nights.set(area, { at: Date.now(), load });
  // A failed answer must not be served again for ten minutes.
  load.catch(() => nights.delete(area));
  return load;
}

export function useMeteors(area: MeteorArea, skip = false): Polled<MeteorNight> {
  return usePoll(() => fetchNight(area), 30 * 60_000, [area], skip);
}

export function fetchMeteorDetail(id: string, signal?: AbortSignal): Promise<MeteorDetail> {
  return api<MeteorDetail>(`/api/listen/meteors/${id}`, { signal });
}

/** Open the profile of one meteor in the shared Profiler slot. */
export function openMeteor(meteor: Meteor): void {
  profile.open({ kind: "meteor", id: meteor.id, data: meteor });
}

/** Switch the "Meteors last night" layer on and open the City map, centred on `at` when given. */
export function showMeteors(at?: { lat: number; lon: number }, zoom = 5): void {
  showLayer(METEOR_LAYER);
  if (at) go("city", { action: "fly", arg: `${at.lat},${at.lon},${zoom}` });
}

/** The microphone nearest to a point, among those that are live. */
export function nearestMic(mics: readonly Microphone[], at: { lat: number; lon: number }): Microphone | null {
  let best: { mic: Microphone; d: number } | null = null;
  for (const mic of mics) {
    if (!mic.live) continue;
    const d = distanceM(at, mic);
    if (!best || d < best.d) best = { mic, d };
  }
  return best?.mic ?? null;
}
