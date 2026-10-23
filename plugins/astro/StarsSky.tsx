import { useEffect } from "react";
import { useInterval } from "../../app/core/hooks";
import type { SkyLayerProps, SkyTarget } from "../sky/extension";
import { sun } from "./bodies";
import { BRIGHT_STARS, starPosition } from "./stars";

/** The ~60 brightest stars. Dimmed while the Sun is up, because you cannot see them then. */
export default function StarsSky({ observer, report }: SkyLayerProps): null {
  const compute = (): void => {
    const now = new Date();
    const daylight = sun(observer.lat, observer.lon, now).el > -6;
    const targets: SkyTarget[] = [];
    for (const [name, raH, decDeg, mag] of BRIGHT_STARS) {
      const p = starPosition(raH, decDeg, observer.lat, observer.lon, now);
      if (p.el < 0) continue;
      targets.push({
        id: `star:${name}`,
        label: name,
        detail: `magnitude ${mag.toFixed(1)}`,
        az: p.az,
        el: p.el,
        shape: "dot",
        tone: "bone",
        // Brighter stars (lower magnitude) weigh more; labels show for the brightest few.
        weight: Math.max(0.05, Math.min(0.7, (2.4 - mag) / 3.4)) * (daylight ? 0.4 : 1),
        entity: { kind: "body", id: `star:${name}`, data: { body: "star", name, raH, decDeg, mag } },
        background: true,
      });
    }
    report(targets);
  };
  useEffect(compute, [observer.lat, observer.lon]);
  useInterval(compute, 20_000);
  return null;
}
