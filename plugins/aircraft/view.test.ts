import { describe, expect, test } from "bun:test";
import { nearView } from "./view";

const at = (lat: number, lon: number) => ({ lat, lon });
const box = (west: number, east: number) => ({ west, east, south: -10, north: 10 });

describe("nearView", () => {
  test("inside a plain view, and just outside the padding", () => {
    expect(nearView(at(0, 5), box(0, 10))).toBe(true);
    expect(nearView(at(0, 10.04), box(0, 10))).toBe(true);
    expect(nearView(at(0, 10.2), box(0, 10))).toBe(false);
    expect(nearView(at(11, 5), box(0, 10))).toBe(false);
  });

  test("a Pacific view with east past 180 holds aircraft on both sides of the date line", () => {
    const view = box(170, 190);
    expect(nearView(at(0, 175), view)).toBe(true);
    expect(nearView(at(0, -175), view)).toBe(true);
    expect(nearView(at(0, -169), view)).toBe(false);
    expect(nearView(at(0, 160), view)).toBe(false);
  });

  test("a view with west below -180 wraps the other way", () => {
    const view = box(-190, -170);
    expect(nearView(at(0, 175), view)).toBe(true);
    expect(nearView(at(0, -175), view)).toBe(true);
    expect(nearView(at(0, 0), view)).toBe(false);
  });

  test("a view as wide as the world holds every longitude", () => {
    expect(nearView(at(0, -179), box(-180, 180))).toBe(true);
    expect(nearView(at(0, 90), box(-200, 200))).toBe(true);
  });
});
