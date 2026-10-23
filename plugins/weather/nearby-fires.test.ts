import { describe, expect, test } from "bun:test";
import { fireItems } from "./nearby-fires";
import type { FireSpots } from "./types";

// Meteosat detections around Nuoro in Sardinia, in the shape of /api/weather/fires.
const data: FireSpots = {
  time: "2026-07-14T13:40:00Z",
  stepMin: 10,
  spots: [
    { lat: 40.12, lon: 9.01 },
    { lat: 40.13, lon: 9.05 },
    { lat: 40.4, lon: 9.3 },
    { lat: 39.2, lon: 9.1 },
    { lat: 40.11, lon: 9.0 },
    { lat: 40.14, lon: 9.02 },
  ],
};
const NUORO = { lat: 40.12, lon: 9.0 };
const NOW = Date.parse("2026-07-14T13:55:00Z");

describe("fireItems", () => {
  test("lists the three nearest spots inside the radius, nearest first, in alarm", () => {
    const items = fireItems(data, NUORO, 8000, NOW);
    expect(items.map((i) => i.at)).toEqual([
      { lat: 40.12, lon: 9.01 },
      { lat: 40.11, lon: 9.0 },
      { lat: 40.14, lon: 9.02 },
    ]);
    expect(items[0]).toMatchObject({ kind: "see", tone: "alarm", primary: { label: "Show on map" } });
    expect(new Set(items.map((i) => i.id)).size).toBe(3);
  });

  test("keeps nothing beyond the radius", () => {
    expect(fireItems(data, NUORO, 500, NOW)).toEqual([]);
    expect(fireItems(data, { lat: 41.5, lon: 12 }, 8000, NOW)).toEqual([]);
  });

  test("says nothing when the satellite picture is older than three hours", () => {
    expect(fireItems(data, NUORO, 8000, NOW + 3 * 3_600_000)).toEqual([]);
  });

  test("a frame with no spots gives an empty list", () => {
    expect(fireItems({ ...data, spots: [] }, NUORO, 8000, NOW)).toEqual([]);
  });
});
