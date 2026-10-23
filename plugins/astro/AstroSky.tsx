import { useEffect } from "react";
import { useInterval } from "../../app/core/hooks";
import type { SkyLayerProps, SkyTarget } from "../sky/extension";
import { moon, sun } from "./bodies";

/** The Sun and the Moon, with today's path of each across your sky. */
export default function AstroSky({ observer, report }: SkyLayerProps): null {
  const compute = (): void => {
    const now = new Date();
    const s = sun(observer.lat, observer.lon, now);
    const m = moon(observer.lat, observer.lon, now);
    const path = (fn: (d: Date) => { az: number; el: number }): { az: number; el: number }[] =>
      Array.from({ length: 97 }, (_, i) => fn(new Date(now.getTime() + (i - 48) * 15 * 60_000)));
    const targets: SkyTarget[] = [
      {
        id: "body:sun",
        label: "Sun",
        detail: `${s.el >= 0 ? `${Math.round(s.el)}° up` : `${Math.round(-s.el)}° below horizon`}`,
        az: s.az,
        el: s.el,
        shape: "sun",
        tone: "sodium",
        weight: 1,
        path: path((d) => sun(observer.lat, observer.lon, d)),
        entity: { kind: "body", id: "sun", data: { body: "sun", name: "Sun" } },
      },
      {
        id: "body:moon",
        label: "Moon",
        detail: `${m.phaseName} · ${Math.round(m.illumination * 100)}% lit`,
        az: m.az,
        el: m.el,
        shape: "moon",
        tone: "bone",
        weight: 1,
        path: path((d) => moon(observer.lat, observer.lon, d)),
        entity: { kind: "body", id: "moon", data: { body: "moon", name: "Moon" } },
      },
    ];
    report(targets);
  };
  useEffect(compute, [observer.lat, observer.lon]);
  useInterval(compute, 30_000);
  return null;
}
