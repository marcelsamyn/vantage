import { useEffect } from "react";
import { fmt } from "../../app/core/format";
import { useAmbientMotion, useInterval } from "../../app/core/hooks";
import { useSettings } from "../../app/core/settings";
import { lookAngle } from "../../shared/geo";
import type { SkyLayerProps, SkyTarget } from "../sky/extension";
import { projected, useTraffic } from "./client";
import { emergencyOf } from "./emergency";

/** Aircraft as radar targets: where to look to see each one from where you stand. */
export default function AircraftSky({ observer, report }: SkyLayerProps): null {
  const compute = (): void => {
    const snapshot = useTraffic.getState().snapshot;
    if (!snapshot) return report([]);
    const units = useSettings.getState().units;
    const now = Date.now();
    const targets: SkyTarget[] = [];
    for (const a of snapshot.aircraft) {
      if (a.onGround || a.altFt === null) continue;
      const p = projected(a, snapshot.fetchedAt, now);
      const look = lookAngle(observer, { ...p, altM: a.altFt * 0.3048 });
      if (look.el < -1) continue;
      targets.push({
        id: `aircraft:${a.hex}`,
        label: a.callsign ?? a.registration ?? a.hex.toUpperCase(),
        detail: `${fmt.int(a.altFt)} ft · ${fmt.distance(look.rangeM, units)}`,
        az: look.az,
        el: look.el,
        shape: "plane",
        tone: emergencyOf(a) ? "alarm" : "sodium",
        headingDeg: a.trackDeg ?? undefined,
        weight: Math.max(0.15, 1 - look.rangeM / 80_000),
        entity: { kind: "aircraft", id: a.hex, data: { ...a, fetchedAt: snapshot.fetchedAt } },
      });
    }
    report(targets);
  };

  useEffect(compute, [observer.lat, observer.lon]);
  // Positions follow the clock: often while someone watches, every 15 s at rest.
  useInterval(compute, useAmbientMotion() ? 1000 : 15_000);
  return null;
}
