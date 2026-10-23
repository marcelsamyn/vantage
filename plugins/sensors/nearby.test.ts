import { describe, expect, test } from "bun:test";
import { sensorItems, STALE_MS } from "./nearby";
import type { Sensor } from "./types";

// Sensors around Piazza Venezia in Rome, shaped like /api/sensors/near answered on 8 October 2026.
const NOW = Date.UTC(2026, 9, 8, 20, 30);
const ROME = { lat: 41.8955, lon: 12.4823 };

const dust: Sensor = {
  id: "sc:41113",
  kind: "air",
  network: "sensor.community",
  networkName: "Sensor.Community",
  name: null,
  lat: 41.8972,
  lon: 12.4851,
  value: 22.4,
  unit: "µg/m³",
  level: "elevated",
  at: NOW - 4 * 60_000,
  live: true,
  readings: [{ label: "PM10", value: 31.2, unit: "µg/m³" }],
  historyKey: "sds011:54947",
  distanceM: 0,
};
const farDust: Sensor = { ...dust, id: "sc:50210", lat: 41.9101, lon: 12.5102, value: 9.1, level: "fine" };
const station: Sensor = { ...dust, id: "bfs:091620001", kind: "radiation", network: "bfs", name: "Munich-Nord", value: 0.11, unit: "µSv/h", level: "fine", historyKey: null };

describe("sensorItems", () => {
  test("keeps only the nearest sensor of the kind, with its reading, level and tone", () => {
    const items = sensorItems("air", [farDust, dust], ROME, 5000, NOW);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: "sc:41113", title: "Air sensor", detail: "22.4 µg/m³ · Elevated", kind: "see", tone: "sodium", live: true });
    expect(items[0]?.entity).toMatchObject({ kind: "sensor", id: "sc:41113" });
    expect(items[0]?.primary.label).toBe("Show reading");
  });

  test("a bad reading is shown in alarm", () => {
    expect(sensorItems("air", [{ ...dust, value: 83, level: "high" }], ROME, 5000, NOW)[0]).toMatchObject({ tone: "alarm", detail: "83.0 µg/m³ · High" });
  });

  test("uses the sensor's own name and two decimals for radiation", () => {
    expect(sensorItems("radiation", [station], ROME, 5000, NOW)[0]).toMatchObject({ title: "Munich-Nord", detail: "0.11 µSv/h · Normal", tone: "mint" });
  });

  test("ignores sensors of another kind", () => {
    expect(sensorItems("noise", [dust, station], ROME, 5000, NOW)).toEqual([]);
  });

  test("returns nothing when no sensor is within the radius", () => {
    expect(sensorItems("air", [farDust], ROME, 1000, NOW)).toEqual([]);
  });

  test("the radius keeps a sensor inside it and drops one beyond", () => {
    expect(sensorItems("air", [dust], ROME, 400, NOW)).toHaveLength(1);
    expect(sensorItems("air", [dust], ROME, 250, NOW)).toEqual([]);
  });

  test("skips a stale reading and takes the next nearest instead", () => {
    const old: Sensor = { ...dust, at: NOW - STALE_MS - 1 };
    expect(sensorItems("air", [old], ROME, 5000, NOW)).toEqual([]);
    expect(sensorItems("air", [old, farDust], ROME, 5000, NOW)[0]?.id).toBe("sc:50210");
    expect(sensorItems("air", [{ ...dust, at: NOW - STALE_MS }], ROME, 5000, NOW)).toHaveLength(1);
  });

  test("skips a survey from the past and a missing reading", () => {
    expect(sensorItems("radiation", [{ ...station, live: false }], ROME, 5000, NOW)).toEqual([]);
    expect(sensorItems("air", [{ ...dust, value: Number.NaN }], ROME, 5000, NOW)).toEqual([]);
  });
});
