import { expect, test } from "bun:test";
import { destination } from "../../shared/geo";
import { Recording, replayRecording } from "./replay.server";

test("replay never uses a future GPS fix before its receipt and counts withheld error", () => {
  const now = Date.UTC(2026, 9, 16, 12);
  const origin = { lat: 41.9, lon: 12.49 };
  const first = { id: "bus", vehicleId: "bus", tripId: "run", routeId: "64", label: "bus", stopId: "", ...origin, timestamp: now / 1000, bearing: null, speedMs: null, occupancy: null };
  const future = { ...first, ...destination(origin, 90, 1000), timestamp: (now + 20_000) / 1000 };
  const recording = Recording.parse({ source: "synthetic receipt-time regression", receiptClock: "controlled epoch milliseconds", segments: [], samples: [{ receivedAt: now + 10_000, producedAt: null, vehicles: [first] }, { receivedAt: now + 30_000, producedAt: null, vehicles: [future] }, { receivedAt: now + 31_000, producedAt: null, vehicles: [future] }] });
  const result = replayRecording(recording);
  expect(result.observations).toBe(2);
  expect(result.scored).toBe(1);
  expect(result.estimated).toBe(0);
  expect(result.withheld).toBe(1);
  expect(result.medianErrorM).toBeNull();
  expect(result.displayMedianErrorM).toBeCloseTo(1000, 0);
  expect(result.holdMedianM).toBeCloseTo(1000, 0);
});
