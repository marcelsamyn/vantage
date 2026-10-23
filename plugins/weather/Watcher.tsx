import { useEffect } from "react";
import { feed } from "../../app/core/feed";
import { usePoll } from "../../app/core/hooks";
import { useLocation } from "../../app/core/location";
import { describe, fetchWeather, LEVEL_WORDS, useWarnings, warningsHere, warningWindow } from "./client";
import type { OfficialWarning } from "./types";

/** Warns before rain arrives and when a thunderstorm is overhead, from Open-Meteo's 15-minute nowcast. */
export default function WeatherWatcher(): null {
  const here = useLocation((s) => s.here);
  const key = here ? `${here.lat.toFixed(2)},${here.lon.toFixed(2)}` : null;
  const { data } = usePoll((signal) => (here ? fetchWeather(here, signal) : Promise.reject(new Error("no location"))), 10 * 60_000, [key], !here);
  const warnings = useWarnings();

  useEffect(() => {
    if (!data) return;
    const hour = new Date().toISOString().slice(0, 13);
    if (describe(data.now.code).condition === "storm") {
      feed({ level: "alert", source: "weather", title: "Thunderstorm overhead", detail: "Stay away from tall isolated objects and open water.", go: { screen: "city", action: "locate" } }, { key: `weather.storm.${hour}`, dedupeMs: 3 * 3_600_000, toast: true });
      return;
    }
    if (data.now.precipMm > 0) return;
    const now = Date.now();
    const next = data.nowcast.find((s) => s.mm >= 0.2 && new Date(s.time).getTime() > now);
    if (!next) return;
    const minutes = Math.max(5, Math.round((new Date(next.time).getTime() - now) / 60_000));
    if (minutes > 75) return;
    feed({ level: "live", source: "weather", title: `Rain expected in about ${minutes} minutes`, detail: `${next.mm.toFixed(1)} mm in 15 minutes, from Open-Meteo's nowcast.` }, { key: `weather.rain.${hour}`, dedupeMs: 2 * 3_600_000, toast: true });
  }, [data]);

  // Orange or red official warnings that cover your position. Warnings for one area and level are one event.
  useEffect(() => {
    if (!warnings.data) return;
    const groups = new Map<string, OfficialWarning[]>();
    for (const w of warningsHere(warnings.data)) {
      if (w.level === "yellow") continue;
      const key = `${w.level}|${w.area}`;
      groups.set(key, [...(groups.get(key) ?? []), w]);
    }
    for (const list of groups.values()) {
      const lead = list[0];
      if (!lead) continue;
      const hazards = [...new Set(list.map((w) => w.hazard.toLowerCase()))].join(", ");
      feed(
        {
          level: "alert",
          source: "weather",
          title: `${LEVEL_WORDS[lead.level]} warning for ${lead.area}: ${hazards}`,
          detail: `In force ${warningWindow(lead)}. Issued by ${lead.issuer}.`,
          entity: { kind: "warning", id: lead.id, data: lead },
        },
        { key: `weather.warning.${lead.level}.${lead.area}.${Math.floor(Math.min(...list.map((w) => w.from)) / 3600)}`, dedupeMs: 24 * 3_600_000, toast: true },
      );
    }
  }, [warnings.data]);

  return null;
}
