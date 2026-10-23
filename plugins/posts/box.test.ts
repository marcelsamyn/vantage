import { describe, expect, test } from "bun:test";
import { MAX_SPAN, boxKey, focusBox, inBox, snapBox } from "./box";

/** The City map over central Rome at about zoom 13, as MapLibre reports it. */
const ROME = { west: 12.4512345, south: 41.8798761, east: 12.5397012, north: 41.9259113 };

describe("rounding a map view to the cache grid", () => {
  test("rounds outward, so the rounded box still holds the whole view", () => {
    const box = snapBox(ROME);
    expect(box.west).toBeLessThanOrEqual(ROME.west);
    expect(box.south).toBeLessThanOrEqual(ROME.south);
    expect(box.east).toBeGreaterThanOrEqual(ROME.east);
    expect(box.north).toBeGreaterThanOrEqual(ROME.north);
  });

  test("a small pan gives the same box, so the cache answers it", () => {
    const panned = { west: ROME.west + 0.004, south: ROME.south - 0.003, east: ROME.east + 0.004, north: ROME.north - 0.003 };
    expect(boxKey(snapBox(panned))).toBe(boxKey(snapBox(ROME)));
  });

  test("keys carry no floating-point noise", () => {
    expect(boxKey(snapBox({ west: 0.1 + 0.2, south: 0.1 + 0.2, east: 0.3 + 0.2, north: 0.3 + 0.2 }))).toBe("0.3,0.3,0.5,0.5");
  });

  test("a wider view snaps to a coarser grid", () => {
    const city = snapBox(ROME);
    const region = snapBox({ west: 11.5, south: 41.2, east: 13.6, north: 42.6 });
    expect(city.east - city.west).toBeLessThan(0.3);
    expect((region.east - region.west) % 1).toBeCloseTo(0);
  });

  test("fewer cells make a coarser grid that more views share", () => {
    const wide = { west: 12.46, south: 41.85, east: 12.61, north: 41.95 };
    const fine = snapBox(wide, 4);
    const coarse = snapBox(wide, 2);
    expect(coarse.east - coarse.west).toBeGreaterThan(fine.east - fine.west);
  });

  test("a view wider than the largest request is cropped around its centre", () => {
    const box = snapBox({ west: -10, south: 35, east: 30, north: 60 });
    expect(box.east - box.west).toBeLessThanOrEqual(MAX_SPAN + 4);
    expect(inBox(box, { lat: 47.5, lon: 10 })).toBe(true);
  });

  test("a view across the date line or past the poles stays on the globe, with west and south first", () => {
    const box = snapBox({ west: 182, south: 91, east: 170, north: 80 });
    expect(box.west).toBeLessThanOrEqual(box.east);
    expect(box.east).toBeLessThanOrEqual(180);
    expect(box.north).toBeLessThanOrEqual(90);
    expect(box.south).toBeLessThanOrEqual(box.north);
  });
});

describe("the part of a tilted view worth asking about", () => {
  test("cuts a horizon that reaches far beyond the centre", () => {
    const tilted = { west: 12.2, south: 41.85, east: 12.8, north: 42.6 };
    const box = focusBox(tilted, { lat: 41.89, lon: 12.49 }, 13, 1440, 900);
    expect(box.north).toBeLessThan(42);
    expect(box.west).toBeGreaterThan(12.3);
    expect(inBox(box, { lat: 41.89, lon: 12.49 })).toBe(true);
  });

  test("keeps a flat view that already fits", () => {
    expect(focusBox(ROME, { lat: 41.9029, lon: 12.4955 }, 13, 1440, 900)).toEqual(ROME);
  });
});
