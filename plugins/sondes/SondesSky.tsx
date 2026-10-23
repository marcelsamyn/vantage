import { useEffect } from "react";
import { useAmbientMotion, useInterval } from "../../app/core/hooks";
import { fmt } from "../../app/core/format";
import { useSettings } from "../../app/core/settings";
import { lookAngle } from "../../shared/geo";
import type { SkyLayerProps, SkyTarget } from "../sky/extension";
import { altitudeLabel, isFlying, projected, useSondes } from "./client";

/** Weather balloons as radar targets: where to point a camera or an antenna to catch each one. */
export default function SondesSky({ observer, report }: SkyLayerProps): null {
  const compute = (): void => {
    const snapshot = useSondes.getState().snapshot;
    if (!snapshot) return report([]);
    const units = useSettings.getState().units;
    const now = Date.now();
    const targets: SkyTarget[] = [];
    for (const s of snapshot.sondes) {
      if (!isFlying(s)) continue;
      const p = projected(s, now);
      const look = lookAngle(observer, p);
      if (look.el < -1) continue;
      targets.push({
        id: `sonde:${s.serial}`,
        label: s.serial,
        detail: `${altitudeLabel(p.altM, units)} · ${fmt.distance(look.rangeM, units)}`,
        az: look.az,
        el: look.el,
        shape: "diamond",
        tone: "sodium",
        weight: Math.max(0.15, 1 - look.rangeM / 500_000),
        entity: { kind: "sonde", id: s.serial, data: { ...s, fetchedAt: snapshot.fetchedAt } },
      });
    }
    report(targets);
  };

  useEffect(compute, [observer.lat, observer.lon]);
  // Positions follow the clock: often while someone watches, every 15 s at rest.
  useInterval(compute, useAmbientMotion() ? 1000 : 15_000);
  return null;
}
