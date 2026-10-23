import { useEffect } from "react";
import { useAmbientMotion, useInterval } from "../../app/core/hooks";
import type { SkyLayerProps, SkyTarget } from "../sky/extension";
import type { SatGroup } from "./types";
import { displayName, lookFrom, stateAt, useSats } from "./client";

/** Builds a sky layer for a whole CelesTrak group. Large groups update less often to stay smooth. */
export function groupSky(group: SatGroup, refreshMs: number): (props: SkyLayerProps) => null {
  return function GroupSky({ observer, report }: SkyLayerProps): null {
    const { sats } = useSats(group);
    const compute = (): void => {
      const now = new Date();
      const targets: SkyTarget[] = [];
      for (const s of sats) {
        const look = lookFrom(s.rec, observer, now);
        if (!look || look.el < 0) continue;
        const sunlit = group === "visual" ? Boolean(stateAt(s.rec, now)?.sunlit) : false;
        targets.push({
          id: `satellite:${s.ref.norad}`,
          label: displayName(s.ref.name),
          detail: `${Math.round(look.rangeKm).toLocaleString("en-US")} km${sunlit ? " · sunlit" : ""}`,
          az: look.az,
          el: look.el,
          shape: "dot",
          tone: group === "gps-ops" ? "mint" : "ice",
          weight: group === "starlink" ? 0.08 : sunlit ? 0.5 : 0.25,
          entity: { kind: "satellite", id: String(s.ref.norad), data: s.ref },
        });
      }
      report(targets);
    };
    useEffect(compute, [sats, observer.lat, observer.lon]);
    // Positions follow the clock: often while someone watches, every 15 s at rest.
    useInterval(compute, useAmbientMotion() ? refreshMs : 15_000);
    return null;
  };
}
