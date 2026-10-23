import { describe, expect, test } from "bun:test";
import { jamItems } from "./nearby";
import type { JamCellProps, Jamming } from "./types";

// Two hexagon-sized cells over the Gulf of Finland and the Baltic, shaped like /api/gnss/jamming; Helsinki sits in the first.
const hexagon = (lat: number, lon: number, props: JamCellProps): Jamming["cells"]["features"][number] => ({
  type: "Feature",
  properties: props,
  geometry: {
    type: "Polygon",
    coordinates: [
      [
        [lon - 0.4, lat],
        [lon - 0.2, lat + 0.35],
        [lon + 0.2, lat + 0.35],
        [lon + 0.4, lat],
        [lon + 0.2, lat - 0.35],
        [lon - 0.2, lat - 0.35],
        [lon - 0.4, lat],
      ],
    ],
  },
});
const data: Jamming = {
  date: "2026-10-09",
  suspect: false,
  cellsWithTraffic: 2_811,
  cells: {
    type: "FeatureCollection",
    features: [hexagon(60.2, 24.9, { share: 14.3, badAircraft: 21, goodAircraft: 126, level: "heavy" }), hexagon(59.4, 21.5, { share: 4.1, badAircraft: 3, goodAircraft: 70, level: "some" })],
  },
};
const HELSINKI = { lat: 60.17, lon: 24.94 };

describe("jamItems", () => {
  test("standing in a heavy cell is one alarm item for your area", () => {
    const items = jamItems(data, HELSINKI);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ at: "here", kind: "see", tone: "alarm", title: "Heavy GPS interference over your area", detail: "14.3 % of aircraft (21 of 147) reported poor accuracy on 2026-10-09" });
  });

  test("a lighter cell is sodium", () => {
    expect(jamItems(data, { lat: 59.4, lon: 21.5 })[0]).toMatchObject({ tone: "sodium", title: "GPS interference over your area" });
  });

  test("outside every cell, and just beyond a cell's edge, it stays quiet", () => {
    expect(jamItems(data, { lat: 52.37, lon: 4.9 })).toEqual([]);
    expect(jamItems(data, { lat: 60.2, lon: 25.41 })).toEqual([]);
  });

  test("says when the day's data is incomplete", () => {
    expect(jamItems({ ...data, suspect: true }, HELSINKI)[0]?.detail).toEndWith("· incomplete data");
  });

  test("an empty map gives an empty list", () => {
    expect(jamItems({ ...data, cells: { type: "FeatureCollection", features: [] } }, HELSINKI)).toEqual([]);
  });
});
