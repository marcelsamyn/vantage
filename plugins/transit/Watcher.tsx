import { useEffect } from "react";
import { feed, type FeedLevel } from "../../app/core/feed";
import { usePoll } from "../../app/core/hooks";
import { useLocation } from "../../app/core/location";
import { fetchAlerts, isNews } from "./client";
import type { TransitAlert } from "./types";

const POLL_MS = 5 * 60_000;
const MAX_PER_PASS = 4;

const LEVEL: Record<TransitAlert["severity"], FeedLevel> = { alarm: "alert", sodium: "live", info: "info" };

/** Raises feed events for service alerts on the lines around you, from any operator that publishes them. */
export default function TransitWatcher(): null {
  const here = useLocation((s) => s.here);
  const place = here ? `${here.lat.toFixed(2)},${here.lon.toFixed(2)}` : null;
  const { data } = usePoll((signal) => (here ? fetchAlerts(here.lat, here.lon, signal) : Promise.reject(new Error("no location"))), POLL_MS, [place], !here);

  useEffect(() => {
    if (!data) return;
    const now = Date.now();
    const news = data.filter((a) => isNews(a, now)).slice(0, MAX_PER_PASS);
    for (const a of news) {
      const where = a.routes.length > 0 ? `Line ${a.routes.slice(0, 3).join(", ")}` : null;
      const detail = [where, a.text.replace(/\s+/g, " ").slice(0, 140)].filter(Boolean).join(" · ");
      feed({ level: LEVEL[a.severity], source: "transit", title: `${a.operator}: ${a.title}`, detail }, { key: `transit.alert.${a.id}`, dedupeMs: 12 * 3_600_000, toast: a.severity === "alarm" });
    }
  }, [data]);

  return null;
}
