import { useEffect } from "react";
import { feed } from "../../app/core/feed";
import { fmt } from "../../app/core/format";
import { usePoll } from "../../app/core/hooks";
import { useLocation } from "../../app/core/location";
import { useSettings } from "../../app/core/settings";
import { bearingDeg, compassPoint, distanceM } from "../../shared/geo";
import { altitudeLabel, fetchSondes, isFlying, POLL_MS, projected, useSondes } from "./client";
import type { Sonde } from "./types";

/** A descending balloon this close is worth a look. */
const DESCENT_RANGE_M = 100_000;
/** A predicted landing this close to you is a chance to recover the sonde. */
const LANDING_RANGE_M = 30_000;

/** Keeps `useSondes` fresh and tells the feed when a balloon is coming down near you. */
export default function SondesWatcher(): null {
  const { data, error } = usePoll((signal) => fetchSondes(signal), POLL_MS, []);
  const here = useLocation((s) => s.here);

  useEffect(() => {
    if (data) useSondes.setState({ snapshot: data, error: null });
    else if (error) useSondes.setState({ error: error.message });
  }, [data, error]);

  useEffect(() => {
    if (!data || !here) return;
    const units = useSettings.getState().units;
    const now = Date.now();
    for (const s of data.sondes) {
      if (!isFlying(s)) continue;
      const entity = { kind: "sonde" as const, id: s.serial, data: { ...s, fetchedAt: data.fetchedAt } };
      const landing = s.prediction?.landing;
      const landingM = landing ? distanceM(here, landing) : null;
      if (landing && landingM !== null && landingM <= LANDING_RANGE_M && landing.at > now) {
        feed(
          {
            level: "live",
            source: "sondes",
            title: `Weather balloon ${s.serial} will land near you`,
            detail: `Predicted ${fmt.distance(landingM, units)} ${compassPoint(bearingDeg(here, landing))} of you, ${fmt.until(landing.at, now)} · ${radioLine(s)}`,
            entity,
          },
          { key: `sondes.land.${s.serial}`, dedupeMs: 6 * 3_600_000, toast: true },
        );
        continue;
      }
      if (s.phase !== "descending") continue;
      const p = projected(s, now);
      const d = distanceM(here, p);
      if (d > DESCENT_RANGE_M) continue;
      feed(
        {
          level: "live",
          source: "sondes",
          title: `Weather balloon ${s.serial} is coming down`,
          detail: `${fmt.distance(d, units)} ${compassPoint(bearingDeg(here, p))} of you at ${altitudeLabel(p.altM, units)} · ${radioLine(s)}`,
          entity,
        },
        { key: `sondes.down.${s.serial}`, dedupeMs: 6 * 3_600_000 },
      );
    }
  }, [data, here]);

  return null;
}

function radioLine(s: Sonde): string {
  return s.frequencyMHz === null ? "frequency unknown" : `${s.frequencyMHz} MHz`;
}
