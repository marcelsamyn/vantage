import { expect, test } from "bun:test";
import { sourceHealth, stampVehicles, vehicleFeed } from "./feeds.server";

test("transit feed cache retains receipt time and reports a failed refresh while serving old data", async () => {
  const key = `transit:test:${crypto.randomUUID()}`;
  const value = { measuredAt: 123, vehicles: ["bus"] };
  await vehicleFeed(key, key, 5, async () => value, 10_000);
  const successful = sourceHealth().find(s => s.source === key);
  expect(successful?.error).toBeNull();
  await Bun.sleep(10);
  const stale = await vehicleFeed<typeof value>(key, key, 5, async () => { throw new Error("Operator unavailable"); }, 10_000);
  const failed = sourceHealth().find(s => s.source === key);
  expect(stale).toBe(value);
  expect(failed?.receivedAt).toBe(successful?.receivedAt);
  expect(failed?.error).toBe("Operator unavailable");
});

test("measurement, feed production, and receipt times remain distinct", () => {
  const vehicles = stampVehicles({ timestamp: 456, tripUpdates: [], vehicles: [{ id: "bus", tripId: "run", routeId: "64", label: "bus", stopId: "", timestamp: 123, lat: 41.9, lon: 12.5, speedMs: null, bearing: null, occupancy: null }] });
  expect(vehicles[0]?.timestamp).toBe(123);
  expect(vehicles[0]?.producedAt).toBe(456_000);
  expect(vehicles[0]?.receivedAt).toBeGreaterThan(456_000);
});
