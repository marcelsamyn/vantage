import { describe, expect, test } from "bun:test";
import { BusFront, Signpost } from "lucide-react";
import { nearestStops, stopItem, vehicleItems } from "./nearby";
import type { Board, Departure, TransitStop, TripSegment } from "./types";

const NOW = Date.UTC(2026, 9, 9, 10, 0, 0);
const stop: TransitStop = { stopId: "bru:gare-centrale", name: "Gare Centrale", lat: 50.8451, lon: 4.3569, modes: ["BUS"] };

const departure = (route: string, headsign: string, inMin: number, cancelled = false): Departure => ({
  tripId: `${route}-${inMin}`,
  route,
  headsign,
  mode: "BUS",
  time: NOW + inMin * 60_000,
  scheduled: NOW + inMin * 60_000,
  realTime: true,
  cancelled,
  track: null,
  trackChanged: false,
  agency: "STIB",
  routeColor: null,
  routeTextColor: null,
  accessible: null,
  note: null,
  train: null,
  occupancy: null,
});
const board = (departures: Departure[]): Board => ({ stop, departures, source: "Transitous", alerts: [], notice: null });

describe("stopItem", () => {
  test("a stop is a way to move on: Departures first, Walk there after", () => {
    const item = stopItem(stop, board([departure("64", "Termini", 4), departure("8", "Aurelio", 9)]), NOW);
    expect(item).toMatchObject({ kind: "go", primary: { label: "Departures" }, detail: "64 to Termini, then 8", startsAt: NOW + 4 * 60_000 });
    expect(item?.more?.map((a) => a.label)).toEqual(["Walk there"]);
    expect(item).toMatchObject({ title: "Stop · Gare Centrale", tone: "fog", live: false });
    expect(item?.icon).toBe(Signpost);
  });

  test("skips cancelled runs and says nothing when nothing leaves", () => {
    expect(stopItem(stop, board([departure("64", "Termini", 4, true)]), NOW)).toBeNull();
  });
});

describe("vehicleItems", () => {
  const fix = { lat: stop.lat, lon: stop.lon, at: NOW - 10_000, label: "123", feed: "ATAC" };
  const trip: TripSegment = {
    tripId: "atac:64-123", route: "64", mode: "BUS", from: null, to: null,
    departure: NOW, arrival: NOW, delayMin: null, realTime: true,
    line: [], occupancy: "few_seats",
    fix,
  };

  test("shows a measured nearby bus at its fix and opens the vehicle profile", () => {
    const items = vehicleItems([trip], stop, 500, NOW);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: trip.tripId, title: "Bus 64", kind: "go", tone: "sodium", live: true,
      at: { lat: stop.lat, lon: stop.lon }, until: NOW - 10_000 + 300_000,
      entity: { kind: "vehicle", id: trip.tripId }, primary: { label: "View vehicle" },
    });
    expect(items[0]?.icon).toBe(BusFront);
    expect(items[0]?.detail).toContain("GPS");
    expect(items[0]?.detail).toContain("Few seats");
  });

  test("excludes timetable and arrival-time estimates, stale fixes and distant vehicles", () => {
    expect(vehicleItems([
      { ...trip, fix: null, realTime: false },
      { ...trip, fix: null, realTime: true },
      { ...trip, fix: { ...fix, at: NOW - 300_001 } },
      { ...trip, fix: { ...fix, at: 0 } },
      { ...trip, fix: { ...fix, at: NOW + 10_000 } },
      { ...trip, fix: { ...fix, lat: 51 } },
    ], stop, 500, NOW)).toEqual([]);
  });

  test("physical IDs preserve distinct buses assigned to the same operator run", () => {
    const items = vehicleItems([{ ...trip, vehicleId: "atac:123" }, { ...trip, vehicleId: "atac:124" }], stop, 500, NOW);
    expect(items.map(i => i.id)).toEqual(["atac:123", "atac:124"]);
  });

  test("uses the route forecast and labels an old fix as last known", () => {
    const predicted = { ...trip, fix: { ...fix, speedMs: 8, bearing: 90 } };
    const item = vehicleItems([predicted], stop, 500, NOW)[0];
    expect(item?.at).not.toEqual({ lat: fix.lat, lon: fix.lon });
    expect(item?.detail).toContain("Estimated");
    const held = vehicleItems([predicted], stop, 1000, NOW + 121_000)[0];
    expect(held?.live).toBe(false);
    expect(held?.detail).toContain("Last known");
  });

  test("emits one item per vehicle and accepts the next fresh reported position", () => {
    const moved = { ...trip, fix: { ...fix, lat: stop.lat + 0.001, at: NOW } };
    expect(vehicleItems([trip, trip], stop, 500, NOW)).toHaveLength(1);
    expect(vehicleItems([moved], stop, 500, NOW)[0]?.at).toEqual({ lat: moved.fix.lat, lon: moved.fix.lon });
  });
});

describe("nearestStops", () => {
  test("one stop per name, nearest first, none beyond the radius", () => {
    const twin = { ...stop, stopId: "bru:gare-centrale-2", lat: 50.8452 };
    const far = { ...stop, stopId: "bru:far", name: "Far", lat: 50.9 };
    expect(nearestStops([far, twin, stop], { lat: 50.8451, lon: 4.3569 }, 500).map((s) => s.stopId)).toEqual(["bru:gare-centrale"]);
  });
});
