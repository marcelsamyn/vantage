import { api, qs } from "../../app/core/api";
import { fmt } from "../../app/core/format";
import { usePoll, type Polled } from "../../app/core/hooks";
import { useLocation } from "../../app/core/location";
import type { Units } from "../../app/core/settings";
import type { LatLon } from "../../shared/geo";
import type { BelgiumWeather, FireSpots, OfficialWarning, OfficialWarnings, RadarFrames, SatelliteFrames, SnowHistory, SnowStations, Weather, WarningLevel } from "./types";

export const fetchWeather = (at: LatLon, signal?: AbortSignal): Promise<Weather> => api<Weather>(qs("/api/weather/now", { lat: at.lat.toFixed(3), lon: at.lon.toFixed(3) }), { signal });
export const fetchRadar = (signal?: AbortSignal): Promise<RadarFrames> => api<RadarFrames>("/api/weather/radar", { signal });

export type Condition = "clear" | "partly" | "cloudy" | "fog" | "drizzle" | "rain" | "snow" | "showers" | "storm";

/** WMO weather interpretation codes, in words. */
export function describe(code: number): { text: string; condition: Condition } {
  if (code === 0) return { text: "Clear sky", condition: "clear" };
  if (code <= 2) return { text: code === 1 ? "Mainly clear" : "Partly cloudy", condition: "partly" };
  if (code === 3) return { text: "Overcast", condition: "cloudy" };
  if (code === 45 || code === 48) return { text: code === 48 ? "Freezing fog" : "Fog", condition: "fog" };
  if (code >= 51 && code <= 57) return { text: code >= 56 ? "Freezing drizzle" : "Drizzle", condition: "drizzle" };
  if (code >= 61 && code <= 67) return { text: code >= 66 ? "Freezing rain" : code === 65 ? "Heavy rain" : code === 61 ? "Light rain" : "Rain", condition: "rain" };
  if (code >= 71 && code <= 77) return { text: code === 75 ? "Heavy snow" : code === 77 ? "Snow grains" : "Snow", condition: "snow" };
  if (code >= 80 && code <= 82) return { text: code === 82 ? "Violent showers" : "Rain showers", condition: "showers" };
  if (code === 85 || code === 86) return { text: "Snow showers", condition: "snow" };
  if (code === 95) return { text: "Thunderstorm", condition: "storm" };
  if (code === 96 || code === 99) return { text: "Thunderstorm with hail", condition: "storm" };
  return { text: "Unknown conditions", condition: "cloudy" };
}

/** European Air Quality Index bands. */
export function aqiBand(eaqi: number): { label: string; tone: "mint" | "ice" | "sodium" | "alarm" } {
  if (eaqi <= 20) return { label: "Good", tone: "mint" };
  if (eaqi <= 40) return { label: "Fair", tone: "mint" };
  if (eaqi <= 60) return { label: "Moderate", tone: "ice" };
  if (eaqi <= 80) return { label: "Poor", tone: "sodium" };
  if (eaqi <= 100) return { label: "Very poor", tone: "alarm" };
  return { label: "Extremely poor", tone: "alarm" };
}

// ── Satellite loops (EUMETSAT) ──────────────────────────────────

export const fetchLightningFrames = (signal?: AbortSignal): Promise<SatelliteFrames> => api<SatelliteFrames>("/api/weather/lightning/frames", { signal });
export const lightningImageUrl = (t: string): string => qs("/api/weather/lightning/image", { t });
export const fetchFires = (signal?: AbortSignal): Promise<FireSpots> => api<FireSpots>("/api/weather/fires", { signal });

/** "about 16 minutes behind": how old the newest satellite frame is, rounded to a whole minute. */
export function behindWords(frameIso: string, nowMs = Date.now()): string {
  const minutes = Math.max(0, Math.round((nowMs - Date.parse(frameIso)) / 60_000));
  return minutes < 2 ? "less than 2 minutes behind" : `about ${minutes} minutes behind`;
}

// ── Belgium (RMI) ───────────────────────────────────────────────

/** Roughly Belgium. The server answers from the nearest station and says how far it is, so a border town may get a neighbour's reading. */
export const inBelgium = (at: LatLon): boolean => at.lat >= 49.45 && at.lat <= 51.55 && at.lon >= 2.5 && at.lon <= 6.45;

export const fetchBelgium = (at: LatLon, signal?: AbortSignal): Promise<BelgiumWeather> => api<BelgiumWeather>(qs("/api/weather/belgium", { lat: at.lat.toFixed(3), lon: at.lon.toFixed(3) }), { signal });

/** Ceilometer, soil and crowd reports for a Belgian position; holds off elsewhere. */
export function useBelgium(at: LatLon | null): Polled<BelgiumWeather> {
  const active = at !== null && inBelgium(at);
  const key = at ? `${at.lat.toFixed(2)},${at.lon.toFixed(2)}` : "none";
  return usePoll((signal) => (at ? fetchBelgium(at, signal) : Promise.reject(new Error("no location"))), 10 * 60_000, [key], !active);
}

/** Soil, snow and air readings keep a decimal; whole degrees would hide the slow changes that matter there. */
export const temp1 = (c: number, units: Units): string => (units === "imperial" ? `${fmt.one((c * 9) / 5 + 32)}°F` : `${fmt.one(c)}°C`);

// ── Alpine snow (SLF) ───────────────────────────────────────────

export const fetchSnow = (signal?: AbortSignal): Promise<SnowStations> => api<SnowStations>("/api/weather/snow", { signal });
export const fetchSnowHistory = (code: string, signal?: AbortSignal): Promise<SnowHistory> => api<SnowHistory>(qs("/api/weather/snow/history", { code }), { signal });

// ── Official warnings ─────────────────────────────────────────────

export const fetchWarnings = (at: LatLon | null, signal?: AbortSignal): Promise<OfficialWarnings> =>
  api<OfficialWarnings>(qs("/api/weather/warnings", { lat: at?.lat.toFixed(3), lon: at?.lon.toFixed(3) }), { signal });

export const fetchMunicipalities = (zone: string, signal?: AbortSignal): Promise<string[]> => api<string[]>(qs("/api/weather/municipalities", { zone }), { signal });

/** Warnings for Italy, Belgium and the country you are in. The server refreshes its feeds every ten minutes. */
export function useWarnings(): Polled<OfficialWarnings> {
  const here = useLocation((s) => s.here);
  const key = here ? `${here.lat.toFixed(2)},${here.lon.toFixed(2)}` : "none";
  return usePoll((signal) => fetchWarnings(here, signal), 10 * 60_000, [key]);
}

export const LEVEL_RANK: Record<WarningLevel, number> = { yellow: 1, orange: 2, red: 3 };

export const LEVEL_WORDS: Record<WarningLevel, string> = { yellow: "Yellow", orange: "Orange", red: "Red" };

/** What each colour asks of you, in the wording MeteoAlarm uses for all of Europe. */
export const LEVEL_MEANING: Record<WarningLevel, string> = {
  yellow: "Be aware: the weather is potentially dangerous.",
  orange: "Be prepared: the weather is dangerous.",
  red: "Take action: the weather is very dangerous.",
};

/** Warnings whose area contains your position, strongest first. */
export function warningsHere(data: OfficialWarnings): OfficialWarning[] {
  const ids = new Set(data.covering);
  return data.warnings.filter((w) => ids.has(w.id)).sort((a, b) => LEVEL_RANK[b.level] - LEVEL_RANK[a.level] || a.from - b.from);
}

/** True while the warning is in force. */
export const isActive = (w: OfficialWarning, nowMs = Date.now()): boolean => w.from * 1000 <= nowMs && w.until * 1000 > nowMs;

/** "until 18:00", "until tomorrow 02:00", or "from 14:00" for one that has not started. */
export function warningWindow(w: OfficialWarning, nowMs = Date.now()): string {
  const at = (unixS: number): string => {
    const d = new Date(unixS * 1000);
    const sameDay = d.toDateString() === new Date(nowMs).toDateString();
    const next = d.toDateString() === new Date(nowMs + 86_400_000).toDateString();
    const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
    return sameDay ? time : `${next ? "tomorrow" : d.toLocaleDateString("en-GB", { weekday: "short" })} ${time}`;
  };
  return isActive(w, nowMs) ? `until ${at(w.until)}` : `from ${at(w.from)}`;
}
