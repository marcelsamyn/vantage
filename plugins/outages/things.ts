import type { Thing, ThingProvider } from "../../app/core/things";
import { fetchOutages } from "./client";
import { countries } from "./countries";
import { outageRows } from "./details";
import type { Outage } from "./types";

export function outageThings(event: Outage): Thing[] {
  return event.locations.flatMap((code): Thing[] => {
    const country = countries[code];
    if (!country) return [];
    return [{ id: `${event.id}:${code}`, type: "internetoutage", name: event.description ?? event.eventType,
      at: { lat: country.lat, lon: country.lon }, match: [`radar:${event.id}:${code}`], state: "unknown",
      detail: `${country.name} · ${event.outage?.outageType ?? event.scope ?? event.eventType}`,
      rows: [["Map position", `${country.name} reference point; the affected area is not a precise location.`], ...outageRows(event)],
      actions: [{ label: "Open Cloudflare Radar", href: event.linkedUrl ?? "https://radar.cloudflare.com/outage-center" }],
    }];
  });
}

const provide: ThingProvider = async (query, emit, signal) => {
  const report = await fetchOutages(signal);
  emit(report.events.flatMap(outageThings).filter(({ at }) => at.lat >= query.box.south && at.lat <= query.box.north && (query.box.west <= query.box.east ? at.lon >= query.box.west && at.lon <= query.box.east : at.lon >= query.box.west || at.lon <= query.box.east)));
};
export default provide;
