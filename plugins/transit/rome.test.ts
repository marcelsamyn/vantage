import { describe, expect, test } from "bun:test";
import type { RtVehicle } from "./gtfsrt";
import { romeReports, ROME_SOURCE } from "./rome.server";
import { VehicleTracker } from "./tracker";
import { positionAt } from "./fusion";
const placeRomeVehicles = (segments: readonly TripSegment[], vehicles: readonly RtVehicle[], box: {minLat:number;maxLat:number;minLon:number;maxLon:number}, now: number): TripSegment[] => new VehicleTracker().update(segments, romeReports(vehicles), now).filter(vehicle => { const p=positionAt(vehicle, now); return p && p.lat >= box.minLat && p.lat <= box.maxLat && p.lon >= box.minLon && p.lon <= box.maxLon; });
import type { TripSegment } from "./types";

const now = 1_791_801_600_000;
const box = { minLat: 41.8, maxLat: 42, minLon: 12.4, maxLon: 12.6 };
const tripId = "20261012_12:00_it-Lazio-Rome_0#64-9";
const segment: TripSegment = {
  tripId, route: "64", mode: "BUS", from: null, to: null,
  departure: now - 30_000, arrival: now + 60_000, delayMin: 2, realTime: true,
  line: [[12.49, 41.9], [12.51, 41.91]], occupancy: null, fix: null,
};
const vehicle: RtVehicle = {
  id: "123", tripId: "0#64-9", routeId: "64", label: "Bus 123",
  lat: 41.9, lon: 12.5, timestamp: now / 1000 - 10,
  bearing: 90, speedMs: 8, stopId: "stop", occupancy: "few_seats",
};
const feed = (...vehicles: RtVehicle[]): RtVehicle[] => vehicles;

describe("Rome vehicle positions", () => {
  test("uses a measured fix even when arrival times are real-time, and draws one vehicle per trip", () => {
    const result = placeRomeVehicles([segment, { ...segment, departure: now + 60_000 }], feed(vehicle), box, now);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      tripId, delayMin: 2, occupancy: "few_seats", realTime: true,
      fix: { lon: 12.5, lat: 41.9, at: now - 10_000, label: "Bus 123", feed: ROME_SOURCE },
    });
  });

  test("adds fresh vehicles missing from Transitous without guessing their transport mode", () => {
    const result = placeRomeVehicles([], feed(vehicle), box, now);
    expect(result[0]).toMatchObject({ tripId: "atac:0#64-9", route: "64", mode: "OTHER", from: null, to: null, fix: { at: now - 10_000 } });
  });

  test("keeps estimated trips when a fix is stale, missing a timestamp or in the future", () => {
    for (const timestamp of [0, now / 1000 - 301, now / 1000 + 60]) {
      expect(placeRomeVehicles([segment], feed({ ...vehicle, timestamp }), box, now)).toMatchObject([{ ...segment, occupancy: null }]);
      expect(placeRomeVehicles([], feed({ ...vehicle, timestamp }), box, now)).toEqual([]);
    }
    expect(placeRomeVehicles([segment], feed({ ...vehicle, timestamp: now / 1000 - 300 }), box, now)[0]?.fix).not.toBeNull();
  });

  test("removes an estimated trip when its measured position is outside the requested map box", () => {
    expect(placeRomeVehicles([segment], feed({ ...vehicle, lon: 12.7 }), box, now)).toEqual([]);
  });

  test("preserves other operators and clears occupancy when a matched vehicle has no fresh fix", () => {
    const other = { ...segment, tripId: "20261012_12:00_other_0#64-9" };
    const result = placeRomeVehicles([other, segment], feed({ ...vehicle, timestamp: 0 }), box, now);
    expect(result[0]).toMatchObject(other);
    expect(result[1]).toMatchObject({ occupancy: null, fix: null });
  });
});
