import { useEffect } from "react";
import { useAmbientMotion, useInterval } from "../../app/core/hooks";
import type { SkyLayerProps, SkyTarget } from "../sky/extension";
import { CREWED, displayName, lookFrom, stateAt, useSats } from "./client";

/** Crewed space stations, with their path across your sky for the next few minutes. */
export default function StationsSky({ observer, report }: SkyLayerProps): null {
  const { sats } = useSats("stations");
  const crewed = sats.filter((s) => CREWED(s.ref.name));

  const compute = (): void => {
    const now = Date.now();
    const targets: SkyTarget[] = [];
    for (const s of crewed) {
      const look = lookFrom(s.rec, observer, new Date(now));
      if (!look || look.el < -1) continue;
      const state = stateAt(s.rec, new Date(now));
      const path = Array.from({ length: 25 }, (_, i) => lookFrom(s.rec, observer, new Date(now + (i - 4) * 30_000))).filter((p): p is NonNullable<typeof p> => p !== null);
      targets.push({
        id: `satellite:${s.ref.norad}`,
        label: displayName(s.ref.name),
        detail: `${Math.round(look.rangeKm).toLocaleString("en-US")} km · ${state?.sunlit ? "sunlit" : "in Earth's shadow"}`,
        az: look.az,
        el: look.el,
        shape: "diamond",
        tone: "ice",
        weight: 1,
        path,
        entity: { kind: "satellite", id: String(s.ref.norad), data: s.ref },
      });
    }
    report(targets);
  };

  useEffect(compute, [crewed.length, observer.lat, observer.lon]);
  // Positions follow the clock: often while someone watches, every 15 s at rest.
  useInterval(compute, useAmbientMotion() ? 1000 : 15_000);
  return null;
}
