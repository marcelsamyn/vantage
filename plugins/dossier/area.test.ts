import { expect, test } from "bun:test";
import { cellAround, distanceToPathM, inBrussels, inFlanders, inRome, insideRing } from "./area.server";

test("a point beside a kerb line is measured to the nearest part of the line", () => {
  // A kerb running east-west at 41.9 N; a point 10 m north of its middle.
  const kerb: [number, number][] = [
    [12.4, 41.9],
    [12.402, 41.9],
  ];
  const tenMetresNorth = { lat: 41.9 + 10 / 111_320, lon: 12.401 };
  expect(distanceToPathM(tenMetresNorth, kerb)).toBeCloseTo(10, 0);
  // Beyond the end of the line, the distance is to the end point.
  expect(distanceToPathM({ lat: 41.9, lon: 12.4 - 0.0001 }, kerb)).toBeGreaterThan(8);
});

test("a point inside a building outline is inside, and one outside is not", () => {
  const ring: [number, number][] = [
    [3.72, 51.054],
    [3.722, 51.054],
    [3.722, 51.056],
    [3.72, 51.056],
    [3.72, 51.054],
  ];
  expect(insideRing({ lat: 51.055, lon: 3.721 }, ring)).toBe(true);
  expect(insideRing({ lat: 51.057, lon: 3.721 }, ring)).toBe(false);
});

test("two nearby points share one grid cell, and the cell reaches the whole margin around either", () => {
  const a = cellAround({ lat: 41.8986, lon: 12.4768 }, 40);
  const b = cellAround({ lat: 41.8987, lon: 12.4769 }, 40);
  expect(a.key).toBe(b.key);
  expect(a.south).toBeLessThan(41.8986 - 40 / 111_320);
  expect(a.north).toBeGreaterThan(41.8986 + 40 / 111_320);
});

test("regions do not overlap where a register would answer for the wrong city", () => {
  expect(inRome({ lat: 41.9, lon: 12.47 })).toBe(true);
  expect(inBrussels({ lat: 50.8467, lon: 4.3525 })).toBe(true);
  expect(inFlanders({ lat: 50.8467, lon: 4.3525 })).toBe(false);
  expect(inFlanders({ lat: 51.0543, lon: 3.7213 })).toBe(true);
});
