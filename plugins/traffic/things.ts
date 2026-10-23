import { useSettings } from "../../app/core/settings";
import type { Thing, ThingProvider } from "../../app/core/things";
import { trafficRows } from "./display";
import { fetchTraffic } from "./client";
import {
  currentEvents,
  type TrafficEvent,
  type TrafficSourceId,
} from "./types";
export function trafficThings(
  events: readonly TrafficEvent[],
  now: number,
): Thing[] {
  return currentEvents(events, now).flatMap((e): Thing[] => {
    if (e.geometry.type !== "Point") return [];
    const [lon, lat] = e.geometry.coordinates;
    if (lat === undefined || lon === undefined) return [];
    return [
      {
        id: e.id,
        type: "roadtraffic",
        name: e.location || null,
        label: e.title,
        at: { lat, lon },
        match: [`traffic-${e.source}:${e.id}`],
        detail: e.title,
        state: "low",
        rows: trafficRows(e, useSettings.getState().units),
        actions: [{ label: "Open source", href: e.url }],
      },
    ];
  });
}
export function trafficProvider(source: TrafficSourceId): ThingProvider {
  return async ({ box }, emit, signal) => {
    const data = await fetchTraffic(source, box, signal);
    emit(
      trafficThings(
        data.events,
        Date.now(),
      ),
    );
    if (data.failed.length) throw new Error(data.failed.join("; "));
    if (data.capped)
      throw new Error(
        "Traffic coverage is incomplete. Open the source for the full report.",
      );
  };
}
