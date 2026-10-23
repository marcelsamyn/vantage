import { useEffect } from "react";
import { feed } from "../../app/core/feed";
import { fmt } from "../../app/core/format";
import { usePoll } from "../../app/core/hooks";
import { useLocation } from "../../app/core/location";
import { useSettings } from "../../app/core/settings";
import { fetchStreet } from "./client";
import { PM25_WARN } from "./scales";

const HOUR = 3_600_000;

/**
 * Warns when the air within 2 km of you carries more than 55 µg/m³ of fine dust, and alerts when a radiation station within
 * 20 km reads above 0.4 µSv/h in two readings in a row (the server checks the earlier reading, so one bad sample raises nothing).
 */
export default function SensorsWatcher(): null {
  const here = useLocation((s) => s.here);
  const spot = here ? `${here.lat.toFixed(2)},${here.lon.toFixed(2)}` : null;
  const { data } = usePoll((signal) => (here ? fetchStreet(here, signal) : Promise.reject(new Error("no location"))), 5 * 60_000, [spot], !here);

  useEffect(() => {
    if (!data) return;
    const units = useSettings.getState().units;
    const air = data.pm25Near;
    if (air) {
      feed(
        { level: "alert", source: "sensors", title: `Fine dust is high near you: ${air.value.toFixed(0)} µg/m³`, detail: `${fmt.distance(air.distanceM, units)} away · above ${PM25_WARN} µg/m³ the air is unhealthy to breathe for long`, entity: { kind: "sensor", id: air.id, data: air } },
        { key: `sensors.pm25.${air.id}`, dedupeMs: 6 * HOUR, toast: true },
      );
    }
    for (const station of data.radiationAlerts) {
      feed(
        { level: "alert", source: "sensors", title: `Radiation station reads ${station.value.toFixed(2)} µSv/h`, detail: `${station.name ?? station.networkName} · ${fmt.distance(station.distanceM, units)} away · above 0.4 µSv/h in two readings in a row (normal is 0.05–0.2)`, entity: { kind: "sensor", id: station.id, data: station } },
        { key: `sensors.radiation.${station.id}`, dedupeMs: 24 * HOUR, toast: true },
      );
    }
  }, [data]);

  return null;
}
