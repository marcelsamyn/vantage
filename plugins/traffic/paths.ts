import { fetchTraffic, fetchTrafficConfig } from "./client";
import { geographicBoxes } from "../../shared/geo";
import {
  currentEvents,
  overlaps,
  TRAFFIC_SOURCES,
  type TrafficBox,
  type TrafficEvent,
} from "./types";

export async function fetchTrafficPaths(
  box: TrafficBox,
  signal: AbortSignal,
): Promise<{ events: TrafficEvent[]; failed: string[] }> {
  const config = await fetchTrafficConfig(signal);
  const sources = TRAFFIC_SOURCES.filter((s) => {
    if (s.id === "tomtom" && !config.tomtom) return false;
    const area = s.area;
    return !area || geographicBoxes(box).some((part) => overlaps(area, part));
  });
  const results = await Promise.allSettled(
    sources.map(async (s) => ({
      source: s,
      data: await fetchTraffic(s.id, box, signal),
    })),
  );
  const events: TrafficEvent[] = [];
  const failed: string[] = [];
  results.forEach((r, i) => {
    if (r.status === "rejected") {
      failed.push(
        `${sources[i]?.title}: ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`,
      );
      return;
    }
    failed.push(...r.value.data.failed);
    events.push(
      ...r.value.data.events.filter((e) => e.geometry.type !== "Point"),
    );
    if (r.value.data.capped)
      failed.push(
        `${r.value.source.title}: coverage is incomplete; open the source for all reports.`,
      );
  });
  return { events, failed };
}
export function pathFeatures(
  events: readonly TrafficEvent[],
  now: number,
): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: currentEvents(events, now)
      .filter((e) => e.geometry.type !== "Point")
      .map((e) => ({
        type: "Feature",
        geometry: e.geometry,
        properties: { id: `${e.source}:${e.id}` },
      })),
  };
}
