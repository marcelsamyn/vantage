import type { Thing, ThingProvider } from "../../app/core/things";
import { fetchIncidents } from "./client";
import { inside, newIncidents, overlapsCoverage, SOURCES, viewBox } from "./model";
import type { Incident, IncidentSource } from "./types";

function time(at: number | null): string {
  return at === null ? "Not published" : new Date(at).toLocaleString();
}
export function incidentThings(items: readonly Incident[]): Thing[] {
  return items.map((item): Thing => ({
    id: item.id, type: "incident", name: null, label: item.title, at: { lat: item.lat, lon: item.lon }, detail: `${item.status} · ${item.location}`, state: item.alert ? "out" : "unknown", match: item.match,
    rows: [["Incident", item.number], ["Status", item.status], ["Started", time(item.startedAt)], ["Updated", time(item.updatedAt)], ["Position", `${item.lat}, ${item.lon}`], ...item.rows],
    fact: SOURCES[item.source].coverage,
    actions: [
      { label: "Open official incident information", href: item.href },
      { label: "Follow incident updates", run: async () => { const { profile } = await import("../../app/core/profile"); profile.open({ kind: "incident", id: item.id, data: item }); } },
    ],
  }));
}

export function incidentProvider(source: IncidentSource): ThingProvider {
  let baseline: { key: string; seen: Set<string> } | null = null;
  return async ({ box: rawBox, types }, emit, signal): Promise<void> => {
    const box = viewBox(rawBox);
    if (!types.includes("incident") || !overlapsCoverage(source, box)) { baseline = null; emit([]); return; }
    const key = [box.west, box.south, box.east, box.north].join(",");
    const data = await fetchIncidents(source, box, signal);
    if (signal.aborted) return;
    const items = data.incidents.filter((item) => inside(box, item));
    emit(incidentThings(items));
    const seen = baseline?.key === key ? baseline.seen : null;
    const arrivals = newIncidents(items, seen);
    baseline = { key, seen: new Set([...(seen ?? []), ...items.map((item) => item.id)]) };
    if (arrivals.length) {
      const { feed } = await import("../../app/core/feed");
      if (signal.aborted) return;
      for (const item of arrivals) feed({ source: "incidents", level: item.alert ? "alert" : "live", title: `${SOURCES[source].title}: ${item.title}`, detail: `${item.status} · ${item.location}`, entity: { kind: "incident", id: item.id, data: item } }, { key: item.id, dedupeMs: 48 * 3600000 });
    }
  };
}
