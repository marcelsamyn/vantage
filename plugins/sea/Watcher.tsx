import { useEffect } from "react";
import { feed } from "../../app/core/feed";
import { usePoll } from "../../app/core/hooks";
import { useLocation } from "../../app/core/location";
import { useSettings } from "../../app/core/settings";
import { fetchAlerts, height } from "./client";

const HOUR = 3_600_000;

/**
 * Posts to the feed when a gauge within 300 km of you swings far beyond its usual noise. Only the "unusual" level posts:
 * restless gauges are common and stay on the map. The wording says what was measured and that it is not a warning.
 */
export default function SeaWatcher(): null {
  const here = useLocation((s) => s.here);
  const near = usePoll((signal) => (here ? fetchAlerts(here, signal) : Promise.reject(new Error("no location"))), 10 * 60_000, [here?.lat.toFixed(1), here?.lon.toFixed(1)], !here);

  useEffect(() => {
    if (!near.data) return;
    const units = useSettings.getState().units;
    for (const { gauge, analysis } of near.data.alerts) {
      if (analysis.recent.level !== "unusual") continue;
      const swing = analysis.recent;
      const rhythm = swing.kind === "oscillation" ? `going up and down${swing.periodMin ? ` every ${swing.periodMin} minutes` : ""}` : "in one jump";
      feed(
        {
          level: "alert",
          source: "sea",
          title: `Unusual sea level swing at ${gauge.name}`,
          detail: `Swung ${height(swing.rangeM, units)} in 30 minutes, ${rhythm}; this gauge usually moves ${height(analysis.quietM, units)}. A seiche or meteotsunami can do this. Not a tsunami warning.`,
          entity: { kind: "tidegauge", id: gauge.code, data: gauge },
        },
        { key: `sea.${gauge.code}`, dedupeMs: 6 * HOUR },
      );
    }
  }, [near.data]);

  return null;
}
