import { create } from "zustand";

/** Open state of the command palette, so any plugin can open it. */
export const usePalette = create<{ open: boolean; setOpen: (open: boolean) => void }>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}));

export const openPalette = (): void => usePalette.getState().setOpen(true);
