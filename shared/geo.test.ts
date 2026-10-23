import { expect, test } from "bun:test";
import { geographicBox, geographicBoxes } from "./geo";

test("map bounds preserve both date-line halves and normalize world copies", () => {
  expect(geographicBox({ west: 179.99, east: 180.01, south: -10, north: 10 })).toEqual({ west: 179.99, east: -179.99, south: -10, north: 10 });
  expect(geographicBox({ west: 538, east: 542, south: -10, north: 10 })).toEqual({ west: 178, east: -178, south: -10, north: 10 });
  expect(geographicBox({ west: -200, east: 200, south: -95, north: 95 })).toEqual({ west: -180, east: 180, south: -90, north: 90 });
  expect(geographicBoxes({ west: 179, east: 180, south: -10, north: 10 })).toEqual([{ west: 179, east: 180, south: -10, north: 10 }]);
});
