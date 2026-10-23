import { expect, spyOn, test } from "bun:test";
import { fetchTraffic } from "./client";
import { trafficProvider } from "./things";
import type { TrafficEvent } from "./types";

const freshEvent = (): TrafficEvent => ({ id: "refresh-event", source: "tomtom", title: "Lane closure", description: "One lane closed", location: "Road", category: "closure", severity: "minor", status: "active", startsAt: Date.now(), endsAt: null, updatedAt: null, geometry: { type: "Point", coordinates: [179.999, 0] }, rows: [], url: "https://www.tomtom.com/" });

test("a wrapped traffic request retains one successful half when the other fails", async () => {
  const requested: URL[] = [];
  const realFetch = globalThis.fetch;
  const fetch = spyOn(globalThis, "fetch").mockImplementation(Object.assign(async (input: string | URL | Request) => {
    const url = new URL(String(input), "http://localhost");
    requested.push(url);
    if (url.searchParams.get("west") === "-180") throw new Error("western half offline");
    return Response.json({ events: [freshEvent()], fetchedAt: Date.now(), capped: false, failed: [] });
  }, { preconnect: realFetch.preconnect }));
  try {
    const result = await fetchTraffic("tomtom", { west: 179.99, east: 180.01, south: -1, north: 1 }, new AbortController().signal);
    expect(requested.map((url) => [url.searchParams.get("west"), url.searchParams.get("east")])).toEqual([["179.99", "180"], ["-180", "-179.99"]]);
    expect(result.events).toHaveLength(1);
    expect(result.failed).toHaveLength(1);
  } finally { fetch.mockRestore(); }
});

test("stationary traffic refreshes retain incidents newer than the original query", async () => {
  const realFetch = globalThis.fetch;
  const fetch = spyOn(globalThis, "fetch").mockImplementation(Object.assign(async () => Response.json({ events: [freshEvent()], fetchedAt: Date.now(), capped: false, failed: [] }), { preconnect: realFetch.preconnect }));
  try {
    let count = 0;
    await trafficProvider("tomtom")({ box: { west: 179.99, east: 180.01, south: -1, north: 1 }, center: { lat: 0, lon: 180 }, zoom: 14, types: ["roadtraffic"], now: Date.now() - 3600000 }, (items) => { count = items.length; }, new AbortController().signal);
    expect(count).toBe(1);
  } finally { fetch.mockRestore(); }
});
