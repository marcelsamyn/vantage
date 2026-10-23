import { createContext, type ReactNode } from "react";
import { create } from "zustand";
import type { Entity } from "./plugin";

/**
 * The Profiler slot. Any screen, tile, layer or feed event can open a profile for an entity;
 * the shell renders it with the renderer the entity's plugin contributed.
 */
interface ProfileStore {
  entity: Entity | null;
  open: (entity: Entity) => void;
  close: () => void;
}

export const useProfile = create<ProfileStore>((set) => ({
  entity: null,
  open: (entity) => set({ entity }),
  close: () => set({ entity: null }),
}));

export const profile = {
  open: (entity: Entity): void => useProfile.getState().open(entity),
  close: (): void => useProfile.getState().close(),
};

/**
 * The `profilerSections` of the open entity, rendered by the profiler slot. `ProfilerCard` places them after its own
 * content, so a profiler shows sections from other plugins without knowing about them. Null when none apply.
 */
export const ProfilerSectionsContext = createContext<ReactNode>(null);

/** True when `entity` is the one being profiled. Layers use it to highlight their selection. */
export function useIsProfiled(kind: string, id: string): boolean {
  return useProfile((s) => s.entity?.kind === kind && s.entity.id === id);
}
