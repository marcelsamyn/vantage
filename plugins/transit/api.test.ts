import { expect, test } from "bun:test";
import type { BunRequest } from "bun";
import api from "./api";
import { transitClock } from "./feeds.server";
import { positionAt } from "./fusion";
import type { TransitSnapshot } from "./types";

test("a profile reacquires a vehicle on a cold server and clock uncertainty applies before either ingestion", async () => {
  const fetch = globalThis.fetch;
  const at = Math.floor((transitClock.now() - 10_000) / 1000) * 1000;
  const id = "profile-restart-regression";
  globalThis.fetch = (async (input: RequestInfo | URL): Promise<Response> => String(input).includes("entur.io")
    ? Response.json({ data: { vehicles: [{ vehicleId: id, lastUpdated: new Date(at).toISOString(), location: { latitude: 60.123, longitude: 10.123 }, delay: null, mode: "BUS", occupancyStatus: null, line: { publicCode: "10" }, serviceJourney: { id: "run" } }] } })
    : Response.json([])) as typeof globalThis.fetch;
  Object.defineProperty(transitClock, "errorMs", { configurable: true, get: () => 60_000 });
  try {
    const handler = api.routes["GET /vehicle"];
    if (!handler) throw new Error("Vehicle profile route is missing");
    const result = await handler(new Request(`http://127.0.0.1/api/transit/vehicle?id=no:${id}&lat=60.123&lon=10.123`) as BunRequest<string>);
    const snapshot = await result.json() as TransitSnapshot;
    expect(snapshot.vehicles).toHaveLength(1);
    const vehicle = snapshot.vehicles[0];
    expect(vehicle?.vehicleId).toBe(`no:${id}`);
    expect(vehicle?.fix?.at).toBe(at);
    expect(vehicle?.fix?.timeErrorMs).toBe(60_000);
    expect(vehicle && positionAt(vehicle, snapshot.serverTime)?.quality).toBe("last-known");
  } finally {
    globalThis.fetch = fetch;
    Reflect.deleteProperty(transitClock, "errorMs");
  }
});
