import { createContext, useContext, useEffect } from "react";

/** Provided by the Briefing around each tile: tells it whether the tile has anything to show. */
export const TileSlotContext = createContext<((empty: boolean) => void) | null>(null);

/**
 * Hide this tile's panel on the Briefing while `empty` is true. The tile stays mounted, so it keeps polling and
 * comes back by itself when something arrives. Customize mode still shows it, so the viewer can hide it for good.
 */
export function useTileEmpty(empty: boolean): void {
  const report = useContext(TileSlotContext);
  useEffect(() => {
    report?.(empty);
  }, [report, empty]);
}
