import { expect, spyOn, test } from "bun:test";
import { fetchIncidents } from "./client";
import source from "./api";

test("the incident client uses the exact registered root route", async () => {
  const realFetch = globalThis.fetch;
  const route = source.routes["GET /"];
  if (!route) throw new Error("Incident root route missing");
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, routes: { "/api/incidents": { GET: route } } });
  const fetch = spyOn(globalThis, "fetch").mockImplementation(Object.assign(async (input: string | URL | Request, init?: RequestInit) => realFetch(new URL(String(input), server.url), init), { preconnect: realFetch.preconnect }));
  try {
    const result = await fetchIncidents("portugal", { west: 12, east: 13, south: 41, north: 42 });
    expect(result.source).toBe("portugal");
    expect(result.incidents).toEqual([]);
  } finally { fetch.mockRestore(); server.stop(true); }
});
