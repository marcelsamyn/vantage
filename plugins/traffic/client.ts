import { api, errorMessage, qs } from "../../app/core/api";
import { geographicBoxes } from "../../shared/geo";
import type { TrafficBox, TrafficResult, TrafficSourceId } from "./types";
export async function fetchTraffic(
  source: TrafficSourceId,
  box: TrafficBox,
  signal: AbortSignal,
): Promise<TrafficResult> {
  const results = await Promise.allSettled(geographicBoxes(box).map((part) => api<TrafficResult>(qs("/api/traffic/events", { source, ...part }), { signal })));
  const records = results.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
  const failed = results.flatMap((result) => result.status === "rejected" ? [errorMessage(result.reason)] : result.value.failed);
  if (signal.aborted) throw signal.reason;
  if (!records.length) throw new Error(failed.join("; "));
  return { events: [...new Map(records.flatMap((record) => record.events.map((event) => [event.id, event] as const))).values()], fetchedAt: Math.min(...records.map((record) => record.fetchedAt)), capped: records.some((record) => record.capped), failed };
}
export function fetchTrafficConfig(
  signal: AbortSignal,
): Promise<{ tomtom: boolean }> {
  return api<{ tomtom: boolean }>("/api/traffic/config", { signal });
}
