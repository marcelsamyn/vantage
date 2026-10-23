import { useEffect, useRef } from "react";
import { fmt } from "../../app/core/format";
import { feed } from "../../app/core/feed";
import { useFrequencyStore, useFrequencySync } from "./client";

/** A deviation this large is rare enough to mean something big happened: the alert band starts at 150 mHz. */
const ALERT_MHZ = 150;
/** Events older than this are history by the time the app opens; they go in the feed without a toast. */
const FRESH_S = 15 * 60;

/** Raises a feed event when the grid frequency leaves 50 Hz ± 150 mHz. */
export default function PowerWatcher(): null {
  useFrequencySync();
  const t = useFrequencyStore((s) => s.t);
  const hz = useFrequencyStore((s) => s.hz);
  const checked = useRef(0);

  useEffect(() => {
    const newest = t[t.length - 1];
    if (newest === undefined) return;
    let worst: { at: number; hz: number } | null = null;
    for (let i = t.length - 1; i >= 0 && (t[i] ?? 0) > checked.current; i--) {
      const value = hz[i] ?? 50;
      if (Math.abs(value - 50) * 1000 >= ALERT_MHZ && (!worst || Math.abs(value - 50) > Math.abs(worst.hz - 50))) worst = { at: t[i] ?? 0, hz: value };
    }
    checked.current = newest;
    if (!worst) return;
    const mhz = Math.round((worst.hz - 50) * 1000);
    const fresh = Date.now() / 1000 - worst.at < FRESH_S;
    feed(
      {
        level: "alert",
        source: "power",
        title: `Grid frequency ${mhz < 0 ? "fell" : "rose"} to ${worst.hz.toFixed(3)} Hz`,
        detail: `${mhz > 0 ? "+" : "−"}${Math.abs(mhz)} mHz from 50 Hz at ${fmt.clock(worst.at * 1000, true)}. Something big, such as a large power plant or line, tripped somewhere in Europe.`,
        go: { screen: "power", action: "open" },
      },
      { key: `power.frequency.${Math.floor(worst.at / 900)}`, dedupeMs: 15 * 60_000, toast: fresh },
    );
  }, [t, hz]);

  return null;
}
