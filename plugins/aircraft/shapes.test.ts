import { expect, test } from "bun:test";
import { CRAFTS, SHAPES, craftFootprint, craftOf, craftSvg, metresPerPixel } from "./shapes";

test("an aircraft takes its silhouette from its emitter category, and a helicopter type without one still flies as a helicopter", () => {
  expect(craftOf({ category: "A1", typeCode: "C172" })).toBe("light");
  expect(craftOf({ category: "A5", typeCode: "B77W" })).toBe("heavy");
  expect(craftOf({ category: "A7", typeCode: null })).toBe("helicopter");
  expect(craftOf({ category: null, typeCode: "EC35" })).toBe("helicopter");
  expect(craftOf({ category: "B6", typeCode: null })).toBe("drone");
  expect(craftOf({ category: "C2", typeCode: null })).toBe("vehicle");
  expect(craftOf({ category: null, typeCode: null })).toBe("airliner");
});

test("without a category, the type designator picks the silhouette, and the category wins when both are known", () => {
  expect(craftOf({ category: null, typeCode: "C172" })).toBe("light");
  expect(craftOf({ category: null, typeCode: "B77W" })).toBe("heavy");
  expect(craftOf({ category: null, typeCode: "F16" })).toBe("fast");
  expect(craftOf({ category: null, typeCode: "A320" })).toBe("airliner");
  expect(craftOf({ category: "A3", typeCode: "B77W" })).toBe("airliner");
});

/** Signed area of a lon/lat ring; positive when it turns counter-clockwise. */
function geoArea(ring: GeoJSON.Position[]): number {
  let sum = 0;
  for (let i = 1; i < ring.length; i++) sum += (ring[i - 1]?.[0] ?? 0) * (ring[i]?.[1] ?? 0) - (ring[i]?.[0] ?? 0) * (ring[i - 1]?.[1] ?? 0);
  return sum;
}

test("every ring of a footprint turns the same way and closes, so the map reads none of them as a hole", () => {
  for (const craft of CRAFTS) {
    const shape = craftFootprint(craft, 4.35, 50.85, 37, SHAPES[craft].sizeM);
    for (const [ring] of shape.coordinates) {
      expect(ring?.[0]).toEqual(ring?.[ring.length - 1]);
      expect(geoArea(ring ?? [])).toBeGreaterThan(0);
    }
  }
});

test("a footprint points its nose along the track and spans its size in metres", () => {
  const lat = 50.85;
  const ring = craftFootprint("airliner", 4.35, lat, 90, 48).coordinates[0]?.[0] ?? [];
  const metresEast = (p: GeoJSON.Position): number => ((p[0] ?? 0) - 4.35) * 111_320 * Math.cos((lat * Math.PI) / 180);
  const nose = ring.reduce((best, p) => (metresEast(p) > metresEast(best) ? p : best));
  // The nose sits 21.5 grid units ahead of the centre: 21.5 m east at 1 m per unit, on the centre line.
  expect(metresEast(nose)).toBeCloseTo(21.5, 1);
  expect(nose[1]).toBeCloseTo(lat, 6);
  // Facing east, the wingtips reach 18.3 m to either side.
  const metresNorth = (p: GeoJSON.Position): number => ((p[1] ?? 0) - lat) * 110_540;
  expect(Math.max(...ring.map(metresNorth))).toBeCloseTo(18.3, 1);
  expect(Math.min(...ring.map(metresNorth))).toBeCloseTo(-18.3, 1);
});

test("every silhouette draws as one tintable SVG path", () => {
  for (const craft of CRAFTS) expect(craftSvg(craft)).toMatch(/^<svg [^>]+><path fill="#fff" d="M[\d. L]+Z(M[\d. L]+Z)*"\/><\/svg>$/);
});

test("metres per pixel halves with each zoom level", () => {
  expect(metresPerPixel(0, 0)).toBeCloseTo(78_271.5, 0);
  expect(metresPerPixel(15, 0) * 2).toBeCloseTo(metresPerPixel(14, 0), 6);
});
