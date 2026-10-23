import { create } from "zustand";
import { readStored, writeStored } from "../../app/core/hooks";
import type { Era } from "./types";

export type CompareMode = "fade" | "swipe";
export type Tint = "true" | "night";

interface Preferences {
  mode: CompareMode;
  tint: Tint;
  /** How strongly the past shows, 0.1–1. */
  strength: number;
  open: boolean;
}

const PREFERENCES_KEY = "timemachine:prefs";
const DEFAULTS: Preferences = { mode: "fade", tint: "true", strength: 1, open: false };

interface TimeMachineStore extends Preferences {
  /** The era on the map; null shows today. Not remembered between visits. */
  era: Era | null;
  /** Where the swipe divider sits, 0 (left edge) to 1 (right edge). */
  split: number;
  /** Set by "Show this place in the oldest map"; the control acts on it once it knows the eras. */
  seekOldest: boolean;
  /** Said once, in the control, after a command could not do what it was asked. */
  notice: string | null;
  set: (patch: Partial<Preferences>) => void;
  pick: (era: Era | null) => void;
  setSplit: (split: number) => void;
  askForOldest: () => void;
  settle: (notice: string | null) => void;
}

const saved = readStored<Partial<Preferences>>(PREFERENCES_KEY, {});

export const useTimeMachine = create<TimeMachineStore>((set, get) => ({
  ...DEFAULTS,
  ...saved,
  era: null,
  split: 0.5,
  seekOldest: false,
  notice: null,
  set: (patch) => {
    const { mode, tint, strength, open } = { ...get(), ...patch };
    writeStored(PREFERENCES_KEY, { mode, tint, strength, open } satisfies Preferences);
    set(patch);
  },
  pick: (era) => set({ era, notice: null }),
  setSplit: (split) => set({ split }),
  askForOldest: () => {
    get().set({ open: true });
    set({ seekOldest: true, notice: null });
  },
  settle: (notice) => set({ seekOldest: false, notice }),
}));
