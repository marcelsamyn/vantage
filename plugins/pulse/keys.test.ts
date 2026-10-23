import { describe, expect, test } from "bun:test";
import { bridgeSetKey } from "./bridges.server";
import { snapOut } from "./rivers.server";

describe("snapOut", () => {
  test("covers the view on a 0.1 degree grid", () => {
    const view = { west: 2.34567, south: 48.81234, east: 2.41999, north: 48.90001 };
    const box = snapOut(view, 10);
    expect(box).toEqual({ west: 2.3, south: 48.8, east: 2.5, north: 49 });
    expect(box.west).toBeLessThanOrEqual(view.west);
    expect(box.south).toBeLessThanOrEqual(view.south);
    expect(box.east).toBeGreaterThanOrEqual(view.east);
    expect(box.north).toBeGreaterThanOrEqual(view.north);
  });

  test("small pans inside one cell give the same box", () => {
    const a = snapOut({ west: 2.31, south: 48.81, east: 2.39, north: 48.89 }, 10);
    const b = snapOut({ west: 2.34, south: 48.84, east: 2.38, north: 48.88 }, 10);
    expect(a).toEqual(b);
  });

  test("handles negative coordinates by rounding outward", () => {
    expect(snapOut({ west: -1.52, south: -0.04, east: -1.41, north: 0.02 }, 10)).toEqual({ west: -1.6, south: -0.1, east: -1.4, north: 0.1 });
  });
});

describe("bridgeSetKey", () => {
  test("does not depend on order", () => {
    expect(bridgeSetKey(["a", "b", "c"])).toBe(bridgeSetKey(["c", "a", "b"]));
  });

  test("differs for a different set of the same size", () => {
    expect(bridgeSetKey(["a", "b", "c"])).not.toBe(bridgeSetKey(["a", "b", "d"]));
    expect(bridgeSetKey(["a", "b"])).not.toBe(bridgeSetKey(["a", "b", "c"]));
  });
});
