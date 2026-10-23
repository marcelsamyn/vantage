import { useMemo } from "react";
import { useNow } from "../../app/core/hooks";
import type { LatLon } from "../../shared/geo";
import { CREWED, displayName, passes, useSats, type Pass, type Sat } from "./client";

export interface StationPass extends Pass {
  sat: Sat;
  name: string;
}

/** Upcoming passes of the crewed stations over `observer`, recomputed every ten minutes. */
export function useStationPasses(observer: LatLon | null, hours = 72): { passes: StationPass[]; ready: boolean; error: Error | null } {
  const { sats, error } = useSats("stations", observer !== null);
  const bucket = Math.floor(useNow(60_000) / 600_000);
  const list = useMemo(() => {
    if (!observer) return [];
    const from = new Date(bucket * 600_000);
    return sats
      .filter((s) => CREWED(s.ref.name))
      .flatMap((s) => passes(s.rec, observer, from, hours).map((p) => ({ ...p, sat: s, name: displayName(s.ref.name) })))
      .sort((a, b) => a.rise.getTime() - b.rise.getTime());
  }, [sats, observer?.lat, observer?.lon, bucket, hours]);
  return { passes: list, ready: sats.length > 0, error };
}
