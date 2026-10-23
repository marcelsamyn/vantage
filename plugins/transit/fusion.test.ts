import { describe, expect, test } from "bun:test";
import { destination, distanceM } from "../../shared/geo";
import { positionAt } from "./fusion";
import { VehicleTracker } from "./tracker";
import type { TripSegment, VehicleReport } from "./types";

const now = Date.UTC(2026, 9, 16, 12);
const origin = { lat: 41.9, lon: 12.49 };
const end = destination(origin, 90, 3000);
const tripId = "20261016_14:00_it-Lazio-Rome_run";
const leg: TripSegment = { tripId, route: "64", mode: "BUS", from: { ...origin, stopId: "it-Lazio-Rome_A", name: "A" }, to: { ...end, stopId: "it-Lazio-Rome_B", name: "B" }, departure: now - 300_000, arrival: now + 300_000, delayMin: null, realTime: false, line: [[origin.lon, origin.lat], [end.lon, end.lat]], occupancy: null, fix: null };
const observation = (seconds: number, meters: number, speed: number | null = 8, id = "bus"): VehicleReport => ({ source: "atac", scope: "it-Lazio-Rome", id, identity: "vehicle", tripId: "run", route: "64", mode: "BUS", stopId: "", occupancy: null, delayMin: null, fix: { ...destination(origin, 90, meters), at: now + seconds * 1000, speedMs: speed, bearing: 90, label: id, tripId: "run", feed: "ATAC" } });
const measured = (vehicles: TripSegment[]): TripSegment => {
  const vehicle = vehicles.find(v => v.fix);
  if (!vehicle) throw new Error("Expected tracked vehicle");
  return vehicle;
};

describe("transit fusion", () => {
  test("retains undated operator positions without inventing measurement times or motion", () => {
    const tracker = new VehicleTracker();
    const report = observation(0, 100);
    report.fix = { ...report.fix, at: 0, receivedAt: now, evidence: "route-distance" };
    const vehicle = measured(tracker.update([], [report], now));
    expect(vehicle.fix?.at).toBe(0);
    expect(positionAt(vehicle, now + 10_000)?.quality).toBe("last-known");
    const next = { ...report, fix: { ...report.fix, ...destination(origin, 90, 200), receivedAt: now + 10_000 } };
    expect(measured(tracker.update([], [next], now + 10_000)).fix?.lon).toBe(next.fix.lon);
  });

  test("an omitted report retains the measured vehicle instead of restoring its timetable twin", () => {
    const tracker = new VehicleTracker();
    tracker.update([leg], [observation(0, 100)], now);
    const vehicles = tracker.update([leg], [], now + 10_000);
    expect(vehicles).toHaveLength(1);
    expect(vehicles[0]?.vehicleId).toBe("atac:bus");
    expect(vehicles[0]?.fix?.at).toBe(now);
  });

  test("groups aliases and adjacent legs, with one marker per physical vehicle", () => {
    const second = { ...leg, from: leg.to, departure: leg.arrival, arrival: leg.arrival + 300_000 };
    expect(new VehicleTracker().update([leg, second, second], [], now)[0]?.legs).toHaveLength(2);
    const vehicles = new VehicleTracker().update([leg], [observation(0, 100), observation(0, 200, 8, "other")], now);
    expect(vehicles.map(v => v.vehicleId)).toEqual(["atac:bus", "atac:other"]);
  });

  test("does not infer a run when two same-route runs are plausible", () => {
    const report = { ...observation(0, 1500), tripId: "different", fix: { ...observation(0, 1500).fix, tripId: "different" } };
    expect(new VehicleTracker().update([leg], [report], now)).toHaveLength(1);
    expect(new VehicleTracker().update([leg, { ...leg, tripId: tripId + "-2" }], [report], now)).toHaveLength(3);
    const foreign = { ...observation(0, 100), scope: "be" };
    expect(new VehicleTracker().update([leg], [foreign], now)).toHaveLength(2);
  });

  test("the timetable and viewport cannot reset an established physical track", () => {
    const tracker = new VehicleTracker();
    const initial = measured(tracker.update([leg], [observation(0, 100)], now));
    const retained = measured(tracker.update([], [], now + 10_000));
    expect(retained.vehicleId).toBe(initial.vehicleId);
    expect(retained.tracking?.pathId).toBe(initial.tracking?.pathId);
    const changed = measured(tracker.update([{ ...leg, departure: now + 500_000, arrival: now + 900_000 }], [], now + 10_000));
    expect(positionAt(changed, now + 10_000)).toEqual(positionAt(retained, now + 10_000));
  });

  test("an optional full-route response without geometry preserves the usable map path", () => {
    const tracker = new VehicleTracker();
    const initial = measured(tracker.update([leg], [observation(0, 100)], now));
    tracker.setRoute(tripId, []);
    const vehicle = measured(tracker.update([leg], [], now + 10_000));
    expect(vehicle.tracking?.pathId).toBe(initial.tracking?.pathId);
    expect(positionAt(vehicle, now + 10_000)?.quality).toBe("estimated");
  });

  test("a new trip instance resets progress while retaining physical identity", () => {
    const tracker = new VehicleTracker();
    tracker.update([leg], [observation(0, 100)], now);
    const report = observation(10, 200);
    report.fix.serviceDate = "20261017";
    const vehicle = measured(tracker.update([], [report], now + 10_000));
    expect(vehicle.vehicleId).toBe("atac:bus");
    expect(vehicle.tracking?.pathId).toBeNull();
    expect(vehicle.fix?.serviceDate).toBe("20261017");
  });

  test("invalid time and coordinates do not create tracks", () => {
    const report = observation(0, 100);
    const invalid = [0, now - 300_001, now + 5001].map((at, i) => ({ ...report, id: String(i), fix: { ...report.fix, at } }));
    expect(new VehicleTracker().update([], [...invalid, { ...report, fix: { ...report.fix, lat: 91 } }], now)).toEqual([]);
  });
});

describe("transit prediction", () => {
  test("compensates delayed GPS at measurement time, not receipt time", () => {
    const vehicle = measured(new VehicleTracker().update([leg], [observation(-20, 320), observation(-10, 400)], now));
    const p = positionAt(vehicle, now);
    expect(p?.quality).toBe("estimated");
    expect(distanceM(p ?? origin, destination(origin, 90, 480))).toBeLessThan(25);
    expect(vehicle.fix?.at).toBe(now - 10_000);
  });

  test("propagates a 25-second-old slow-moving report to the current time", () => {
    const vehicle = measured(new VehicleTracker().update([leg], [observation(-35, 65, 1), observation(-25, 75, 1)], now));
    const p = positionAt(vehicle, now);
    expect(p?.quality).toBe("estimated");
    expect(distanceM(p ?? origin, destination(origin, 90, 100))).toBeLessThan(8);
    expect(vehicle.fix?.at).toBe(now - 25_000);
  });

  test("duplicate and reordered reports give the same position and uncertainty", () => {
    const a = observation(-30, 240), b = observation(-20, 320), c = observation(-10, 400);
    const first = new VehicleTracker();
    first.update([leg], [a, b, c], now);
    const expected = positionAt(measured(first.update([leg], [c, c], now)), now);
    const second = new VehicleTracker();
    second.update([leg], [a, c], now);
    expect(positionAt(measured(second.update([leg], [b], now)), now)).toEqual(expected);
  });

  test("precision recovery after a gap depends on accepted observations, not request batching", () => {
    const a = observation(0, 100), b = observation(130, 1140), c = observation(140, 1220);
    const sequential = new VehicleTracker();
    sequential.update([leg], [a], now);
    sequential.update([leg], [], now + 121_000);
    sequential.update([leg], [b], now + 130_000);
    const expected = positionAt(measured(sequential.update([leg], [c], now + 140_000)), now + 145_000);
    expect(expected?.quality).toBe("estimated");
    const batch = new VehicleTracker();
    batch.update([leg], [a], now);
    expect(positionAt(measured(batch.update([leg], [c, b], now + 140_000)), now + 145_000)).toEqual(expected);
    const late = new VehicleTracker();
    late.update([leg], [a, c], now + 140_000);
    expect(positionAt(measured(late.update([leg], [b], now + 140_000)), now + 145_000)).toEqual(expected);
  });

  test("quarantines a lone spike and accepts the following normal observation", () => {
    const tracker = new VehicleTracker();
    tracker.update([leg], [observation(0, 100)], now);
    const spike = measured(tracker.update([leg], [observation(10, 2100)], now + 10_000));
    expect(spike.fix?.at).toBe(now);
    const normal = measured(tracker.update([leg], [observation(20, 260)], now + 20_000));
    expect(normal.fix?.at).toBe(now + 20_000);
    expect(distanceM(positionAt(normal, now + 25_000) ?? origin, destination(origin, 90, 300))).toBeLessThan(40);
  });

  test("re-evaluates a previously quarantined candidate when an earlier fix arrives late", () => {
    const a = observation(0, 100), b = observation(30, 550), c = observation(40, 700);
    const ordered = new VehicleTracker();
    const expected = measured(ordered.update([leg], [a, b, c], now + 40_000));
    const delayed = new VehicleTracker();
    delayed.update([leg], [a, c], now + 40_000);
    const actual = measured(delayed.update([leg], [b], now + 40_000));
    expect(positionAt(actual, now + 45_000)).toEqual(positionAt(expected, now + 45_000));
  });

  test("discarded rejected events still define the replay boundary", () => {
    const tracker = new VehicleTracker();
    const spikes = Array.from({ length: 300 }, (_, i) => observation((i + 1) / 2, i % 2 ? 10_000 : 30_000));
    tracker.update([leg], [observation(0, 100), ...spikes], now + 150_000);
    const vehicle = measured(tracker.update([leg], [observation(10, 180)], now + 150_000));
    expect(vehicle.fix?.at).toBe(now);
  });

  test("incremental updates and checkpoint trimming equal a full ordered replay", () => {
    const reports = Array.from({ length: 301 }, (_, i) => observation(i / 2, 100 + i * 4));
    const incremental = new VehicleTracker();
    for (const report of reports) incremental.update([leg], [report], report.fix.at);
    const batch = new VehicleTracker();
    const expected = measured(batch.update([leg], reports, now + 150_000));
    expect(positionAt(incremental.get("atac:bus") ?? leg, now + 155_000)).toEqual(positionAt(expected, now + 155_000));
  });

  test("movement history keeps the correct occurrence through a figure-eight crossing", () => {
    const west = destination(origin, 270, 400);
    const line = [west, origin, destination(origin, 45, 300), destination(origin, 135, 300), origin, destination(origin, 225, 300), destination(origin, 315, 300), origin];
    const looping = { ...leg, line: line.map(p => [p.lon, p.lat] satisfies [number, number]) };
    const coordinates = [destination(origin, 270, 100), destination(origin, 270, 20), destination(origin, 45, 60)];
    const reports = coordinates.map((p, i) => ({ ...observation(i * 10, 0), fix: { ...observation(i * 10, 0).fix, ...p, bearing: null } }));
    const vehicle = measured(new VehicleTracker().update([looping], reports, now + 20_000));
    expect(vehicle.tracking?.states[0]?.s).toBeLessThan(500);
    expect(distanceM(positionAt(vehicle, now + 25_000) ?? west, destination(origin, 45, 100))).toBeLessThan(35);
  });

  test("fresh stop evidence keeps a stopped vehicle still", () => {
    const vehicle = measured(new VehicleTracker().update([leg], [observation(-20, 100, 0), observation(-10, 100, 0)], now));
    expect(distanceM(positionAt(vehicle, now) ?? origin, destination(origin, 90, 100))).toBeLessThan(2);
  });

  test("an outage widens the range for an unannounced stop or departure", () => {
    for (const stopped of [false, true]) {
      const reports = [0, 10, 20, 30].map(t => observation(t, stopped ? 100 : 100 + 8 * t, stopped ? 0 : 8));
      const vehicle = measured(new VehicleTracker().update([leg], reports, now + 30_000));
      const last = stopped ? 100 : 340;
      const actual = destination(origin, 90, stopped ? last + 360 : last + 40);
      const p = positionAt(vehicle, now + 80_000);
      expect(p?.quality).toBe("last-known");
      expect(p?.rangeM).toBeGreaterThan(150);
      const actualS = stopped ? last + 360 : last + 40;
      expect(p?.ranges.some(r => r.from <= actualS && actualS <= r.to)).toBe(true);
      expect(distanceM(actual, vehicle.fix ?? origin)).toBeGreaterThan(30);
    }
  });

  test("an expired forecast returns the measured point, never the predicted endpoint", () => {
    const vehicle = measured(new VehicleTracker().update([leg], [observation(0, 100)], now));
    expect(positionAt(vehicle, now + 121_000)).toMatchObject({ quality: "last-known", estimated: false, lon: vehicle.fix?.lon, lat: vehicle.fix?.lat });
    expect(positionAt(vehicle, now + 300_001)).toBeNull();
  });

  test("does not connect disconnected path sections or invent a reverse drive", () => {
    const detached = { ...leg, departure: leg.arrival, arrival: leg.arrival + 300_000, line: [[13, 42], [13.01, 42]] satisfies [number, number][] };
    const vehicle = measured(new VehicleTracker().update([leg, detached], [observation(0, 2990)], now));
    expect(positionAt(vehicle, now + 10_000)?.quality).toBe("last-known");
    const reverse = { ...leg, line: [...leg.line].reverse() };
    const inferred = { ...observation(0, 1500), tripId: "unknown" };
    expect(new VehicleTracker().update([reverse], [{ ...inferred, fix: { ...inferred.fix, bearing: null } }], now)).toHaveLength(1);
    expect(new VehicleTracker().update([reverse], [inferred], now)).toHaveLength(2);
  });
});
