import { expect, spyOn, test } from "bun:test";
import { fetchShips } from "./client";

test("ship requests preserve the date-line view in another world copy", async () => {
  let requested = "";
  const realFetch = globalThis.fetch;
  const fetch = spyOn(globalThis, "fetch").mockImplementation(Object.assign(async (input: string | URL | Request) => {
    requested = String(input);
    return Response.json({ vessels: [], fetchedAt: Date.now() });
  }, { preconnect: realFetch.preconnect }));
  try {
    await fetchShips({ west: 538, east: 542, south: -10, north: 10 });
    const query = new URL(requested, "http://localhost").searchParams;
    expect(query.get("west")).toBe("178.00");
    expect(query.get("east")).toBe("-178.00");
  } finally { fetch.mockRestore(); }
});
