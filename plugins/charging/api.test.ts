import { expect, spyOn, test } from "bun:test";
import source, { Availability, Search, searchStations } from "./api";
import { availabilityState, stationThing } from "./things";
import type { ChargingReport } from "./types";

const counts = { available: 0, occupied: 0, reserved: 0, unknown: 0, outOfService: 0 };
const fixture = (change: Partial<typeof counts>) => Availability.parse({ chargingAvailability: "park-1", connectors: [{ type: "IEC62196Type2CCS", total: 2, availability: { current: { ...counts, ...change }, perPowerLevel: [{ ...counts, ...change, powerKW: 150 }] } }] });
test("availability distinguishes occupied, offline, unknown and absent data", () => {
  expect(availabilityState(fixture({ available: 1, occupied: 1 }))).toBe("ok");
  expect(availabilityState(fixture({ occupied: 2 }))).toBe("low");
  expect(availabilityState(fixture({ outOfService: 2 }))).toBe("out");
  expect(availabilityState(fixture({ outOfService: 1, unknown: 1 }))).toBe("unknown");
  expect(availabilityState(null)).toBe("unknown");
  expect(availabilityState({ chargingAvailability: "park-1", connectors: [] })).toBe("unknown");
});

test("the charger route retains successful availability when another station fails", async () => {
  const realFetch = globalThis.fetch;
  const originalKey = process.env.VANTAGE_TOMTOM_KEY;
  process.env.VANTAGE_TOMTOM_KEY = "charging-test-key";
  const ids: string[] = [];
  const fetch = spyOn(globalThis, "fetch").mockImplementation(Object.assign(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    expect(init?.redirect).toBe("error");
    if (url.pathname.includes("categorySearch")) return Response.json({ summary: { totalResults: 3 }, results: ["ready", "failed", "unreported"].map((id, i) => ({ id, position: { lat: 50.01 + i / 100, lon: 4.01 }, poi: { name: id }, ...(id === "unreported" ? {} : { dataSources: { chargingAvailability: { id: `test-${id}` } } }) })) });
    const id = url.searchParams.get("chargingAvailability");
    if (!id) throw new Error("Missing availability ID");
    ids.push(id);
    if (id === "test-failed") return new Response("charging-test-key unavailable", { status: 503 });
    return Response.json({ ...fixture({ available: 1, occupied: 1 }), chargingAvailability: id });
  }, { preconnect: realFetch.preconnect }));
  const route = source.routes["GET /stations"];
  if (!route) throw new Error("Charger route missing");
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, routes: { "/api/charging/stations": { GET: route } } });
  try {
    const response = await realFetch(`${server.url}api/charging/stations?west=4&south=50&east=4.1&north=50.1`);
    expect(response.status).toBe(200);
    const result: ChargingReport = await response.json();
    expect(result.stations).toHaveLength(3);
    const ready = result.stations.find((station) => station.id === "ready");
    const failed = result.stations.find((station) => station.id === "failed");
    const unreported = result.stations.find((station) => station.id === "unreported");
    expect(ready?.availabilityError).toBeNull();
    expect(ready?.availability?.connectors[0]?.availability.current.available).toBe(1);
    expect(failed?.availability).toBeNull();
    expect(failed?.availabilityError).toBeTruthy();
    expect(unreported?.availabilityError).toBeNull();
    expect(new Set(ids)).toEqual(new Set(["test-ready", "test-failed"]));
    expect(ids).toHaveLength(2);
    expect(JSON.stringify(result)).not.toContain("charging-test-key");
  } finally {
    server.stop(true);
    fetch.mockRestore();
    if (originalKey === undefined) delete process.env.VANTAGE_TOMTOM_KEY;
    else process.env.VANTAGE_TOMTOM_KEY = originalKey;
  }
});
test("search keeps identifiers and connector power and bounds unsafe websites", () => {
  const result = Search.parse({ summary: { totalResults: 1 }, results: [{ id: "poi-1", position: { lat: 41.9, lon: 12.5 }, poi: { name: "Roma", url: "javascript:alert(1)" }, chargingPark: { connectors: [{ connectorType: "IEC62196Type2CCS", ratedPowerKW: 150 }] }, dataSources: { chargingAvailability: { id: "park-1" } } }] });
  const station = searchStations(result)[0];
  if (!station) throw new Error("Expected station");
  expect(station.website).toBeNull();
  station.availability = fixture({ available: 1, occupied: 1 });
  station.checkedAt = 1791680400000;
  const thing = stationThing(station, true);
  expect(thing.match).toEqual(["tomtom:poi-1", "tomtom-charging:park-1"]);
  expect(thing.detail).toBe("1 connectors available");
  expect(thing.rows?.some(([label]) => label.includes("150 kW"))).toBe(true);
  expect(thing.rows?.some(([label]) => label === "Coverage")).toBe(true);
  expect(Availability.safeParse({ chargingAvailability: "p", connectors: [{ type: "x", total: -1 }] }).success).toBe(false);
});
