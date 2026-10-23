import { definePlugin } from "../../app/core/plugin";
import { glyph } from "./glyph";

export default definePlugin({ id: "outages", name: "Internet outages", description: "Internet outages and traffic anomalies observed by Cloudflare Radar.", contributes: {
  screen: { title: "Internet outages", summary: "Cloudflare Radar outage and anomaly reports", section: "signals", order: 80, glyph, view: () => import("./Screen") },
  thingTypes: [{ id: "internetoutage", title: "Internet outages", group: "network", tone: "alarm", order: 30, nearby: false, mergeM: 0, description: "Cloudflare Radar events from the past seven days, shown at country reference points. Scope and affected networks appear in each profile.", icon: () => import("./icon").then((m) => m.default) }],
  thingSources: [{ id: "outages.radar", title: "Cloudflare Radar", types: ["internetoutage"], refreshMs: 5 * 60_000, attribution: "Cloudflare Radar · country reference points: Natural Earth", load: () => import("./things") }],
  profilers: { outage: () => import("./OutageProfile") },
} });
