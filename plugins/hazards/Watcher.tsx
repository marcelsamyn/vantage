import { useEffect } from "react";
import { feed } from "../../app/core/feed";
import { fmt } from "../../app/core/format";
import { usePoll } from "../../app/core/hooks";
import { useLocation } from "../../app/core/location";
import { useSettings } from "../../app/core/settings";
import { distanceM } from "../../shared/geo";
import { DISASTER_NAME, EONET_NAME, fetchDisasters, fetchEvents, fetchQuakes } from "./client";

const HOUR = 3_600_000;
/** Natural events this close to you are worth a line in the feed. */
const EVENT_RANGE_M = 100_000;
const WATCHED_CATEGORIES = new Set(["wildfires", "volcanoes", "severeStorms", "floods"]);

/** Reports quakes near you, strong quakes anywhere, new red disaster alerts and natural events close to you. Only events from the past hour count for quakes. */
export default function HazardWatcher(): null {
  const here = useLocation((s) => s.here);
  const quakes = usePoll((signal) => fetchQuakes("day", signal), 2 * 60_000, []);
  const disasters = usePoll((signal) => fetchDisasters(signal), 15 * 60_000, []);
  const around = here ? { west: here.lon - 1.5, east: here.lon + 1.5, south: here.lat - 1, north: here.lat + 1 } : null;
  const events = usePoll((signal) => (around ? fetchEvents(around, signal) : Promise.reject(new Error("no location"))), 30 * 60_000, [around?.west.toFixed(1), around?.south.toFixed(1)], !around);

  useEffect(() => {
    if (!quakes.data) return;
    const now = Date.now();
    const units = useSettings.getState().units;
    for (const q of quakes.data) {
      if (now - q.time > HOUR) continue;
      const d = here ? distanceM(here, q) : Number.POSITIVE_INFINITY;
      const near = d < 300_000 && q.mag >= 2.5;
      // Small quakes only matter when they are close: Italian networks report them within minutes.
      const small = d < 50_000 && q.mag >= 1.5;
      if (!near && !small && q.mag < 6.5) continue;
      const entity = { kind: "quake" as const, id: q.id, data: q };
      feed(
        { level: near || q.mag >= 7 ? "alert" : "live", source: "hazards", title: `M${q.mag.toFixed(1)} earthquake ${near || small ? `${fmt.distance(d, units)} from you` : q.place}`, detail: `${q.place} · ${fmt.one(q.depthKm)} km deep`, entity },
        { key: `quake.${q.id}`, dedupeMs: 6 * HOUR, toast: (near && q.mag >= 3.5) || q.mag >= 7 },
      );
    }
  }, [quakes.data, here]);

  useEffect(() => {
    if (!disasters.data) return;
    for (const d of disasters.data) {
      if (d.alert !== "Red") continue;
      feed(
        { level: "alert", source: "hazards", title: `Red alert: ${d.name}`, detail: `${DISASTER_NAME[d.type]}${d.countries ? ` · ${d.countries}` : ""}`, entity: { kind: "disaster", id: d.id, data: d } },
        { key: `disaster.${d.id}`, dedupeMs: 24 * HOUR },
      );
    }
  }, [disasters.data]);

  useEffect(() => {
    if (!events.data || !here) return;
    const units = useSettings.getState().units;
    for (const e of events.data) {
      const d = distanceM(here, e);
      if (d > EVENT_RANGE_M || !WATCHED_CATEGORIES.has(e.category)) continue;
      feed(
        { level: "live", source: "hazards", title: `${EONET_NAME[e.category]} ${fmt.distance(d, units)} from you`, detail: e.title, entity: { kind: "eonet", id: e.id, data: e } },
        { key: `eonet.${e.id}`, dedupeMs: 24 * HOUR },
      );
    }
  }, [events.data, here]);

  return null;
}
