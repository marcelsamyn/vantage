import { useEffect } from "react";
import { create } from "zustand";
import { localEnabled } from "../../plugins";
import { distanceM } from "../../shared/geo";
import type { IpLocation, Place } from "../../shared/location";
import { api, errorMessage, qs } from "./api";
import { readStored, useRunning, writeStored } from "./hooks";

export type LocationSource = "gps" | "ip" | "manual";

export interface Here {
  lat: number;
  lon: number;
  /** Radius of uncertainty in metres; null when unknown (IP location is only city-accurate). */
  accuracyM: number | null;
  source: LocationSource;
  /** Human label, e.g. "Monti, Rome". */
  label: string | null;
  at: number;
}

interface LocationStore {
  here: Here | null;
  status: "idle" | "locating" | "ready" | "failed";
  /** Why precise location is unavailable, shown to the user with a fix. */
  note: string | null;
  locate: () => Promise<void>;
  /** Take a fix from a position watch (see `useWatchLocation`). */
  track: (coords: GeolocationCoordinates) => void;
  setManual: (lat: number, lon: number, label: string) => void;
}

/** A watched fix replaces the position only after this much movement, so a walk updates views every few seconds, not every second. */
const TRACK_STEP_M = 10;
/** The area name holds within this distance; further away it is looked up again. */
const LABEL_HOLDS_M = 1000;

function gps(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (!("geolocation" in navigator)) return reject(new Error("This browser has no location service"));
    navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 9000, maximumAge: 60_000 });
  });
}

async function labelFor(lat: number, lon: number): Promise<string | null> {
  try {
    const place = await api<Place | null>(qs("/api/core/reverse", { lat, lon }));
    return place?.area ?? null;
  } catch {
    return null;
  }
}

const storedHere = readStored<Here | null>("here", null);
// A saved IP fix belongs to the server that resolved it, not the viewer of a hosted app.
const initialHere = !localEnabled && storedHere?.source === "ip" ? null : storedHere;

export const useLocation = create<LocationStore>((set, get) => ({
  here: initialHere,
  status: "idle",
  note: null,

  locate: async () => {
    if (get().status === "locating") return;
    const previous = get().here;
    if (previous?.source === "manual") return;
    set({ status: "locating" });

    let next: Here | null = null;
    let note: string | null = null;
    try {
      const pos = await gps();
      next = { lat: pos.coords.latitude, lon: pos.coords.longitude, accuracyM: pos.coords.accuracy, source: "gps", label: null, at: Date.now() };
    } catch (err) {
      if (!localEnabled) {
        set({ status: previous ? "ready" : "failed", note: "Location is unavailable. Allow location for this site, or open the command palette and choose “Set my location to…”." });
        return;
      }
      const denied = typeof GeolocationPositionError !== "undefined" && err instanceof GeolocationPositionError && err.code === err.PERMISSION_DENIED;
      note = denied
        ? "Location permission is off, so VANTAGE uses your internet address instead (city-level). Allow location for this site to get street-level accuracy."
        : `Precise location is unavailable (${errorMessage(err)}). Using your internet address instead.`;
      try {
        const ip = await api<IpLocation>("/api/core/iploc");
        next = { lat: ip.lat, lon: ip.lon, accuracyM: null, source: "ip", label: [ip.city, ip.country].filter(Boolean).join(", "), at: Date.now() };
      } catch (ipErr) {
        set({ status: previous ? "ready" : "failed", note: `Could not find your location: ${errorMessage(ipErr)}` });
        return;
      }
    }

    set({ here: next, status: "ready", note });
    writeStored("here", next);
    // An IP position is only city-accurate; naming the exact point would invent precision.
    if (next.source !== "gps") return;
    const label = await labelFor(next.lat, next.lon);
    if (label && get().here === next) {
      const labelled = { ...next, label };
      set({ here: labelled });
      writeStored("here", labelled);
    }
  },

  track: (coords) => {
    const previous = get().here;
    if (previous?.source === "manual") return;
    const fix = { lat: coords.latitude, lon: coords.longitude };
    const moved = previous ? distanceM(previous, fix) : Number.POSITIVE_INFINITY;
    const sharper = previous?.accuracyM != null && coords.accuracy < previous.accuracyM / 2;
    if (previous?.source === "gps" && moved < TRACK_STEP_M && !sharper) return;
    const keepLabel = previous?.source === "gps" && previous.label !== null && moved < LABEL_HOLDS_M;
    const next: Here = { ...fix, accuracyM: coords.accuracy, source: "gps", label: keepLabel ? previous.label : null, at: Date.now() };
    set({ here: next, status: "ready", note: null });
    writeStored("here", next);
    if (keepLabel) return;
    void labelFor(next.lat, next.lon).then((label) => {
      if (!label || get().here !== next) return;
      const labelled = { ...next, label };
      set({ here: labelled });
      writeStored("here", labelled);
    });
  },

  setManual: (lat, lon, label) => {
    const next: Here = { lat, lon, accuracyM: null, source: "manual", label, at: Date.now() };
    set({ here: next, status: "ready", note: null });
    writeStored("here", next);
  },
}));

/** Return to automatic location after a manual override. */
export function clearManualLocation(): void {
  const here = useLocation.getState().here;
  if (here?.source === "manual") useLocation.setState({ here: { ...here, source: "ip" } });
  void useLocation.getState().locate();
}

/**
 * Follow your position while `active`, for views that move with you. It uses the browser's position watch, which
 * reports as you walk, and stops while the tab is hidden or the view's screen is not shown. A failed watch changes
 * nothing: the position from `locate()` stays.
 */
export function useWatchLocation(active: boolean): void {
  const running = useRunning();
  useEffect(() => {
    if (!active || !running || !("geolocation" in navigator)) return;
    const id = navigator.geolocation.watchPosition(
      (pos) => useLocation.getState().track(pos.coords),
      () => undefined,
      { enableHighAccuracy: true, maximumAge: 5_000, timeout: 30_000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [active, running]);
}
