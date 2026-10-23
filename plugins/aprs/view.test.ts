import { expect, test } from "bun:test";
import { geographicBox, insideBox } from "./view";

test("unwrapped map views and world views produce exact valid APRS filters", () => {
  const box = geographicBox({ west: 170, east: 190, south: -10, north: 10 });
  expect(box).toEqual({ west: 170, east: -170, south: -10, north: 10 });
  expect(insideBox(box, { lat: 0, lon: 179 })).toBe(true);
  expect(insideBox(box, { lat: 0, lon: -179 })).toBe(true);
  expect(insideBox(box, { lat: 0, lon: 0 })).toBe(false);
  expect(geographicBox({ west: -200, east: 200, south: -80, north: 80 })).toEqual({ west: -180, east: 180, south: -80, north: 80 });
});
