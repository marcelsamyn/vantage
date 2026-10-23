import { create } from "zustand";
import type { MotionEvent, Zone } from "./types";

export const MAX_EVENTS = 50;
export const HISTORY_LENGTH = 90;

/**
 * Sentry state. It lives outside the screen so the Briefing tile can show the last event,
 * but the engine only runs while the Scan screen is mounted, and `armed` resets when it closes.
 */
interface SentryStore {
  armed: boolean;
  armedAt: number | null;
  /** 1 (calm) to 10 (jumpy). */
  sensitivity: number;
  zone: Zone | null;
  /** Share of the watched area that changed in the latest sample, in percent. */
  level: number;
  history: number[];
  events: MotionEvent[];
  lastEvent: MotionEvent | null;
  arm: () => void;
  disarm: () => void;
  setSensitivity: (v: number) => void;
  setZone: (z: Zone | null) => void;
  sample: (level: number) => void;
  record: (event: MotionEvent) => void;
  clearEvents: () => void;
}

export const useSentry = create<SentryStore>((set) => ({
  armed: false,
  armedAt: null,
  sensitivity: 5,
  zone: null,
  level: 0,
  history: [],
  events: [],
  lastEvent: null,
  arm: () => set({ armed: true, armedAt: Date.now(), level: 0, history: [] }),
  disarm: () => set({ armed: false, armedAt: null, level: 0, history: [] }),
  setSensitivity: (sensitivity) => set({ sensitivity }),
  setZone: (zone) => set({ zone }),
  sample: (level) => set((s) => ({ level, history: [...s.history, level].slice(-HISTORY_LENGTH) })),
  record: (event) => set((s) => ({ events: [event, ...s.events].slice(0, MAX_EVENTS), lastEvent: event })),
  clearEvents: () => set({ events: [], lastEvent: null }),
}));

/** Frame-difference limits for a sensitivity setting. */
export function thresholds(sensitivity: number): { pixel: number; area: number } {
  return { pixel: 42 - sensitivity * 3.5, area: 6 - sensitivity * 0.5 };
}
