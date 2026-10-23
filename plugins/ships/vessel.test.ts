import { describe, expect, test } from "bun:test";
import { categoryOf, etaMs, flagOf, navStatusName, shipTypeName, unpackEta } from "./vessel";

describe("flags", () => {
  test("the first three digits of an MMSI name the flag state", () => {
    expect(flagOf(230994000)).toBe("Finland");
    expect(flagOf(257595600)).toBe("Norway");
    expect(flagOf(205123000)).toBe("Belgium");
    expect(flagOf(247123000)).toBe("Italy");
    expect(flagOf(367078250)).toBe("USA");
  });

  test("auxiliary craft and navigation aids carry the code after their prefix; coast stations have no flag", () => {
    expect(flagOf(982570001)).toBe("Norway");
    expect(flagOf(992300001)).toBe("Finland");
    expect(flagOf(2573555)).toBeNull();
    expect(flagOf(3669702)).toBeNull();
  });

  test("an unknown code gives no flag", () => {
    expect(flagOf(100000000)).toBeNull();
  });
});

describe("types", () => {
  test("categories and names", () => {
    expect(categoryOf(70)).toBe("cargo");
    expect(categoryOf(79)).toBe("cargo");
    expect(categoryOf(84)).toBe("tanker");
    expect(categoryOf(60)).toBe("passenger");
    expect(categoryOf(30)).toBe("fishing");
    expect(categoryOf(37)).toBe("pleasure");
    expect(categoryOf(52)).toBe("other");
    expect(categoryOf(null)).toBe("other");
    expect(shipTypeName(52)).toBe("Tug");
    expect(shipTypeName(74)).toBe("Cargo ship");
    expect(shipTypeName(0)).toBe("Vessel");
  });

  test("navigation status", () => {
    expect(navStatusName(5)).toBe("Moored");
    expect(navStatusName(null)).toBeNull();
    expect(navStatusName(13)).toBeNull();
  });
});

describe("arrival time", () => {
  test("Digitraffic's packed ETA unpacks to month, day, hour, minute", () => {
    expect(unpackEta(674752)).toEqual([10, 9, 15, 0]);
    expect(unpackEta(0)).toBeNull();
    expect(unpackEta(null)).toBeNull();
  });

  test("the year is the current one unless the date is long past", () => {
    const now = Date.UTC(2026, 9, 8, 12);
    expect(etaMs([10, 9, 15, 0], now)).toBe(Date.UTC(2026, 9, 9, 15));
    expect(etaMs([1, 5, 8, 0], now)).toBe(Date.UTC(2027, 0, 5, 8));
    expect(etaMs([5, 5, 8, 0], now)).toBeNull();
    expect(etaMs([10, 1, 8, 0], now)).toBe(Date.UTC(2026, 9, 1, 8));
    expect(etaMs([6, 31, 8, 0], now)).toBeNull();
    expect(etaMs(null, now)).toBeNull();
  });
});
