import { expect, spyOn, test } from "bun:test";
import { fetchCharging } from "./client";

test("charger requests carry wrapped geographic bounds at the date line", async () => {
  let requested = "";
  const realFetch = globalThis.fetch;
  const fetch = spyOn(globalThis, "fetch").mockImplementation(Object.assign(async (input: string | URL | Request) => {
    requested = String(input);
    return Response.json({ stations: [], fetchedAt: Date.now(), capped: false });
  }, { preconnect: realFetch.preconnect }));
  try {
    await fetchCharging({ west: 179.99, east: 180.01, south: -10, north: 10 }, new AbortController().signal);
    const query = new URL(requested, "http://localhost").searchParams;
    expect(query.get("west")).toBe("179.99");
    expect(query.get("east")).toBe("-179.99");
  } finally { fetch.mockRestore(); }
});
