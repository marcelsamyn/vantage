import { describe, expect, test } from "bun:test";
import { nearestIndex, rulerStart, rulerTicks, yearToFraction } from "./scale";

const END = 2036;

describe("yearToFraction", () => {
  test("runs from the start of the ruler to its end", () => {
    expect(yearToFraction(1550, 1550, END)).toBe(0);
    expect(yearToFraction(END, 1550, END)).toBe(1);
  });

  test("clamps years outside the ruler", () => {
    expect(yearToFraction(1200, 1550, END)).toBe(0);
    expect(yearToFraction(2200, 1550, END)).toBe(1);
  });

  test("gives later decades more room than earlier ones", () => {
    const early = yearToFraction(1700, 1550, END) - yearToFraction(1600, 1550, END);
    const late = yearToFraction(2000, 1550, END) - yearToFraction(1900, 1550, END);
    expect(late).toBeGreaterThan(early);
  });

  test("never moves backwards", () => {
    let last = -1;
    for (let year = 1550; year <= END; year += 10) {
      const f = yearToFraction(year, 1550, END);
      expect(f).toBeGreaterThanOrEqual(last);
      last = f;
    }
  });
});

describe("rulerStart", () => {
  test("begins a little before the oldest picture, on a multiple of five", () => {
    expect(rulerStart(1988, END)).toBe(1980);
    expect(rulerStart(1777, END)).toBe(1760);
    expect(rulerStart(1777, END) % 5).toBe(0);
  });

  test("never begins before the oldest map the catalog holds", () => {
    expect(rulerStart(1571, END)).toBe(1550);
    expect(rulerStart(1400, END)).toBe(1550);
  });
});

describe("rulerTicks", () => {
  test("marks centuries on a long ruler", () => {
    expect(rulerTicks(1550, END)).toEqual([1600, 1700, 1800, 1900, 2000]);
  });

  test("marks quarter centuries on a medium ruler", () => {
    expect(rulerTicks(1900, END)).toEqual([1925, 1950, 1975, 2000, 2025]);
  });

  test("marks decades on a short ruler", () => {
    expect(rulerTicks(1990, END)).toEqual([2000, 2010, 2020, 2030]);
  });

  test("keeps labels off the ends of the ruler", () => {
    const ticks = rulerTicks(1980, END);
    for (const t of ticks) {
      expect(t).toBeGreaterThan(1980);
      expect(t).toBeLessThan(END);
    }
  });
});

describe("nearestIndex", () => {
  test("snaps to the closest dot", () => {
    expect(nearestIndex([0.1, 0.4, 0.9], 0.45)).toBe(1);
    expect(nearestIndex([0.1, 0.4, 0.9], 0.99)).toBe(2);
    expect(nearestIndex([0.1, 0.4, 0.9], -3)).toBe(0);
  });

  test("returns -1 for an empty ruler", () => {
    expect(nearestIndex([], 0.5)).toBe(-1);
  });
});
