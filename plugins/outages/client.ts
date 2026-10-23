import { api } from "../../app/core/api";
import { usePoll } from "../../app/core/hooks";
import type { OutageReport } from "./types";

let previous: Set<string> | null = null;
export async function fetchOutages(signal: AbortSignal): Promise<OutageReport> {
  const report = await api<OutageReport>("/api/outages/events", { signal });
  const arrivals = previous ? report.events.filter((event) => !previous?.has(event.id)) : [];
  if (arrivals.length && !signal.aborted) {
    const { feed } = await import("../../app/core/feed");
    for (const event of arrivals) feed({ source: "outages", level: "info", title: event.description ?? event.eventType, detail: event.locations.join(", ") || "Location not reported" }, { key: `radar:${event.id}` });
  }
  previous = new Set(report.events.map((event) => event.id));
  return report;
}
export function useOutages(): ReturnType<typeof usePoll<OutageReport>> { return usePoll(fetchOutages, 5 * 60_000, []); }
