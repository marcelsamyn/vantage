import { expect, test } from "bun:test";
import { TransitClock } from "./clock";
import { VehicleDisplay } from "./display";
import { advance } from "./motion";
import { TransitSnapshots } from "./snapshots";
import type { TransitSnapshot, TripSegment } from "./types";

const now = Date.UTC(2026, 9, 16);
const vehicle = (id: string, revision = 1): TripSegment => ({ tripId: id, vehicleId: id, route: "64", mode: "BUS", from: null, to: null, departure: now, arrival: now, delayMin: null, realTime: false, line: [], occupancy: null, fix: { lon: 12.49, lat: 41.9, at: now, feed: "ATAC", label: id }, tracking: { revision, at: now, pathId: null, states: [], maxSpeed: 35, noise: 0.015, lateralM: 0, relocalized: false, precise: true } });
const snapshot = (queryKey: string, revision: number, vehicles: TripSegment[], epoch = "one"): TransitSnapshot => ({ epoch, revision, queryKey, serverTime: now, durationMs: 1000, clockErrorMs: 0, paths: {}, sources: [], vehicles });

test("transit snapshot membership is query-scoped while track revisions are shared", () => {
  const store = new TransitSnapshots();
  store.ingest(snapshot("B", 21, [vehicle("b"), vehicle("shared", 2)]), 0, 1002);
  store.ingest(snapshot("A", 20, [vehicle("a"), vehicle("shared", 1)]), 0, 1002);
  expect(store.view("A").vehicles.map(v => v.vehicleId)).toEqual(["a", "shared"]);
  expect(store.view("A").vehicles[1]?.tracking?.revision).toBe(2);
  store.ingest(snapshot("A", 19, []), 0, 1002);
  expect(store.view("A").vehicles).toHaveLength(2);
  store.ingest(snapshot("B", 22, []), 0, 1002);
  expect(store.view("A").vehicles).toHaveLength(2);
});

test("transit snapshots require epoch confirmation and reject retired responses", () => {
  const store = new TransitSnapshots();
  store.ingest(snapshot("A", 20, [vehicle("a")]), 0, 1002);
  expect(store.ingest(snapshot("A", 1, [], "two"), 0, 1002)).toBe(false);
  store.confirm("two");
  expect(store.ingest(snapshot("A", 1, [vehicle("new")], "two"), 0, 1002)).toBe(true);
  store.confirm("one");
  expect(store.ingest(snapshot("A", 21, [vehicle("old")]), 0, 1002)).toBe(false);
  expect(store.view("A").vehicles[0]?.vehicleId).toBe("new");
});

test("transit snapshot clock excludes server processing time from transport delay", () => {
  const store = new TransitSnapshots();
  store.ingest(snapshot("A", 1, []), 0, 1002);
  expect(store.now(2002)).toBe(now + 1001);
});

test("transit clock ignores host wall-clock steps in either direction", () => {
  let wall = now, elapsed = 0;
  const clock = new TransitClock(() => wall, () => elapsed);
  elapsed = 1000;
  wall += 61_000;
  expect(clock.now()).toBe(now + 1000);
  expect(clock.errorMs).toBe(60_000);
  wall -= 120_000;
  expect(clock.now()).toBe(now + 1000);
  expect(clock.errorMs).toBe(60_000);
});

test("transit prediction is independent of frame-rate partitioning", () => {
  const state = { s: 100, v: 8, p00: 225, p01: 0, p11: 1, weight: 1, section: 0, stopped: false };
  const once = advance(state, 20, 0.015);
  const split = advance(advance(state, 5, 0.015), 15, 0.015);
  expect(split.s).toBeCloseTo(once.s, 8);
  expect(split.p00).toBeCloseTo(once.p00, 8);
  expect(split.p01).toBeCloseTo(once.p01, 8);
});

test("transit display replaces large corrections without a catch-up flight or repeated fade", () => {
  const display = new VehicleDisplay();
  const first = vehicle("bus");
  display.position(first, now, 0, false);
  const corrected = vehicle("bus", 2);
  if (!corrected.fix) throw new Error("Expected GPS");
  corrected.fix = { ...corrected.fix, lon: 12.51, at: now + 10_000 };
  const start = display.position(corrected, now + 10_000, 100, false);
  expect(start?.at.lon).toBe(12.51);
  expect(start?.opacity).toBe(0);
  expect(display.position(corrected, now + 10_100, 250, false)?.opacity).toBe(1);
  expect(display.position(corrected, now + 10_200, 300, false)?.opacity).toBe(1);
  expect(display.position(first, now, 2000, false)?.opacity).toBe(1);
});
