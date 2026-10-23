import { describe, expect, test } from "bun:test";
import { inArea, type LatLon } from "../../shared/geo";
import { footprintsAt, growRing, SKIN_M, type BuildingFeature } from "./footprint";

// Ghent, where a metre east is a little shorter in degrees than a metre north.
const ORIGIN: LatLon = { lat: 51.0535, lon: 3.723 };
const M_PER_DEG = 111_320;
const KX = M_PER_DEG * Math.cos((ORIGIN.lat * Math.PI) / 180);

/** A position `x` metres east and `y` metres north of the origin. */
const at = (x: number, y: number): number[] => [ORIGIN.lon + x / KX, ORIGIN.lat + y / M_PER_DEG];
const metres = ([lon = 0, lat = 0]: readonly number[]): [number, number] => [(lon - ORIGIN.lon) * KX, (lat - ORIGIN.lat) * M_PER_DEG];
const ring = (first: [number, number], ...rest: [number, number][]): number[][] => [first, ...rest, first].map(([x, y]) => at(x, y));
const point = (x: number, y: number): LatLon => {
  const [lon = 0, lat = 0] = at(x, y);
  return { lat, lon };
};
const closeTo = (got: number[][], want: [number, number][]): void => {
  expect(got).toHaveLength(want.length + 1);
  want.forEach(([x, y], i) => {
    const [gx, gy] = metres(got[i] ?? []);
    expect(gx).toBeCloseTo(x, 2);
    expect(gy).toBeCloseTo(y, 2);
  });
};

describe("growRing", () => {
  test("moves every wall of a square out by the same distance, whichever way the ring runs", () => {
    const anticlockwise = ring([0, 0], [10, 0], [10, 10], [0, 10]);
    closeTo(growRing(anticlockwise, 1), [
      [-1, -1],
      [11, -1],
      [11, 11],
      [-1, 11],
    ]);
    const clockwise = ring([0, 0], [0, 10], [10, 10], [10, 0]);
    closeTo(growRing(clockwise, 1), [
      [-1, -1],
      [-1, 11],
      [11, 11],
      [11, -1],
    ]);
  });

  test("keeps the walls of an L-shaped building parallel, moving the inner corner out of the building too", () => {
    const l = ring([0, 0], [20, 0], [20, 8], [8, 8], [8, 20], [0, 20]);
    closeTo(growRing(l, 0.5), [
      [-0.5, -0.5],
      [20.5, -0.5],
      [20.5, 8.5],
      [8.5, 8.5],
      [8.5, 20.5],
      [-0.5, 20.5],
    ]);
  });

  test("pulls the ring in for a negative distance, as for a courtyard", () => {
    closeTo(growRing(ring([4, 4], [6, 4], [6, 6], [4, 6]), -0.4), [
      [4.4, 4.4],
      [5.6, 4.4],
      [5.6, 5.6],
      [4.4, 5.6],
    ]);
  });
});

describe("footprintsAt", () => {
  // The tiles merge buildings of one height: two terraced houses and a block with a courtyard, all 9 m tall.
  const terrace: BuildingFeature = {
    geometry: {
      type: "MultiPolygon",
      coordinates: [[ring([0, 0], [6, 0], [6, 10], [0, 10])], [ring([6, 0], [12, 0], [12, 10], [6, 10])], [ring([30, 0], [50, 0], [50, 20], [30, 20]), ring([36, 6], [44, 6], [44, 14], [36, 14])]],
    },
    properties: { render_height: 9, render_min_height: 0 },
  };

  test("lights only the merged polygon that stands on the spot, slightly larger and taller than it", () => {
    const lit = footprintsAt([terrace], point(9, 5));
    expect(lit.features).toHaveLength(1);
    const [feature] = lit.features;
    expect(feature?.properties).toEqual({ top: 9 + SKIN_M, base: 0 });
    closeTo(feature?.geometry.coordinates[0] ?? [], [
      [6 - SKIN_M, -SKIN_M],
      [12 + SKIN_M, -SKIN_M],
      [12 + SKIN_M, 10 + SKIN_M],
      [6 - SKIN_M, 10 + SKIN_M],
    ]);
  });

  test("keeps a courtyard open, a little smaller, and lights nothing for a spot inside it", () => {
    const lit = footprintsAt([terrace], point(32, 2));
    const courtyard = lit.features[0]?.geometry.coordinates[1] ?? [];
    expect(inArea(point(40, 10), { type: "Polygon", coordinates: [courtyard] })).toBe(true);
    expect(inArea(point(36.2, 10), { type: "Polygon", coordinates: [courtyard] })).toBe(false);
    expect(footprintsAt([terrace], point(40, 10)).features).toEqual([]);
  });

  test("lifts a raised part from just under its own base, and stands a part without heights 6 m tall", () => {
    const tower: BuildingFeature = { geometry: { type: "Polygon", coordinates: [ring([0, 0], [6, 0], [6, 6], [0, 6])] }, properties: { render_height: 80, render_min_height: 12 } };
    const shed: BuildingFeature = { geometry: { type: "Polygon", coordinates: [ring([0, 0], [6, 0], [6, 6], [0, 6])] }, properties: {} };
    expect(footprintsAt([tower, shed], point(3, 3)).features.map((f) => f.properties)).toEqual([
      { top: 80 + SKIN_M, base: 12 - SKIN_M },
      { top: 6 + SKIN_M, base: 0 },
    ]);
  });
});
