import { create } from "zustand";
import { api, qs } from "../../app/core/api";
import type { Units } from "../../app/core/settings";
import { destination, type LatLon } from "../../shared/geo";
import type { AmateurFlight, AmateurSnapshot, LaunchSite, Sonde, SondePrediction, SondeSnapshot, SondeTrack } from "./types";

/** Every balloon SondeHub heard in the past two hours, kept fresh by the sondes watcher. Layers, panels and the tile read from here. */
export const useSondes = create<{ snapshot: SondeSnapshot | null; error: string | null }>(() => ({ snapshot: null, error: null }));

export const POLL_MS = 30_000;

export const fetchSondes = (signal?: AbortSignal): Promise<SondeSnapshot> => api<SondeSnapshot>("/api/sondes/live", { signal });
export const fetchSites = (signal?: AbortSignal): Promise<LaunchSite[]> => api<LaunchSite[]>("/api/sondes/sites", { signal });
export const fetchTrack = (serial: string, signal?: AbortSignal): Promise<SondeTrack> => api<SondeTrack>(qs("/api/sondes/track", { serial }), { signal });

export const fetchBalloons = (signal?: AbortSignal): Promise<AmateurSnapshot> => api<AmateurSnapshot>("/api/sondes/balloons", { signal });
export const fetchBalloonFlight = (id: string, signal?: AbortSignal): Promise<AmateurFlight> => api<AmateurFlight>(qs("/api/sondes/balloon", { id }), { signal });

/** How long ago a balloon was last heard before the map fades it. WSPR balloons report every 10 to 20 minutes when a receiver is in range. */
export const BALLOON_STALE_MS = 6 * 3_600_000;

/** Amateur radio bands that carry WSPR, so a frequency can be named the way operators name it. */
export function bandName(mhz: number | null): string | null {
  if (mhz === null) return null;
  const bands: [number, number, string][] = [
    [1.8, 2, "160 m"],
    [3.5, 3.8, "80 m"],
    [7, 7.3, "40 m"],
    [10.1, 10.15, "30 m"],
    [14, 14.35, "20 m"],
    [18.068, 18.168, "17 m"],
    [21, 21.45, "15 m"],
    [24.89, 24.99, "12 m"],
    [28, 29.7, "10 m"],
  ];
  return bands.find(([lo, hi]) => mhz >= lo && mhz <= hi)?.[2] ?? null;
}

/** Balloons that are transmitting from the air right now. */
export const isFlying = (s: Sonde): boolean => s.phase === "ascending" || s.phase === "descending" || s.phase === "floating";

/**
 * Dead reckoning: where the balloon is now, given its last frame, speed, heading and climb rate.
 * Frames are up to a minute old when they arrive; projecting them keeps motion smooth between polls.
 */
export function projected(s: Sonde, now: number): LatLon & { altM: number } {
  if (!isFlying(s)) return s;
  const elapsedS = Math.min(120, Math.max(0, (now - s.seenAt) / 1000));
  const at = s.speedMs !== null && s.headingDeg !== null ? destination(s, s.headingDeg, s.speedMs * elapsedS) : s;
  const floor = s.prediction?.landing.altM ?? 0;
  return { lat: at.lat, lon: at.lon, altM: Math.max(floor, s.altM + (s.vertMs ?? 0) * elapsedS) };
}

/**
 * Radius of the landing-zone ring. SondeHub publishes no error bar; wind forecasts are off by roughly
 * 2 m/s, so the zone grows by 2 m for every second of flight still to come.
 */
export function landingRadiusM(prediction: SondePrediction, now: number): number {
  return Math.max(500, ((prediction.landing.at - now) / 1000) * 2);
}

/** A ring of points around `center`, as GeoJSON coordinates. */
export function ringAround(center: LatLon, radiusM: number, steps = 48): [number, number][] {
  const ring: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const p = destination(center, (i / steps) * 360, radiusM);
    ring.push([p.lon, p.lat]);
  }
  return ring;
}

export function altitudeLabel(m: number, units: Units): string {
  if (units === "imperial") return `${Math.round(m * 3.28084).toLocaleString("en-US")} ft`;
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;
}

export function modelName(s: Pick<Sonde, "type" | "subtype" | "manufacturer">): string {
  const model = s.subtype ?? s.type;
  return [s.manufacturer, model].filter(Boolean).join(" ");
}

/** Balloons leave this long before the nominal observation hour so they reach altitude on time. */
const LEAD_MS = 45 * 60_000;

/** The next launch from a site: the nominal observation hour and when the balloon usually leaves. */
export function nextLaunch(site: LaunchSite, now: number): { nominalAt: number; launchAt: number } | null {
  const today = new Date(now);
  const day = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  let best: { nominalAt: number; launchAt: number } | null = null;
  for (const hhmm of site.dailyUtc) {
    const [h, m] = hhmm.split(":").map(Number);
    if (h === undefined || m === undefined) continue;
    for (const offset of [0, 1]) {
      const nominalAt = day + offset * 86_400_000 + h * 3_600_000 + m * 60_000;
      const launchAt = nominalAt - LEAD_MS;
      if (launchAt > now && (!best || launchAt < best.launchAt)) best = { nominalAt, launchAt };
    }
  }
  return best;
}
