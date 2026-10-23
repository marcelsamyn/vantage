import { create } from "zustand";

/** The aircraft the City map is following, if any. Set from the aircraft Profiler. */
export const useFollow = create<{ hex: string | null; set: (hex: string | null) => void }>((set) => ({
  hex: null,
  set: (hex) => set({ hex }),
}));
