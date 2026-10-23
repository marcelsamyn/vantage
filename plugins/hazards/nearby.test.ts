import { describe, expect, test } from "bun:test";
import { feltRadiusM, quakeItems } from "./nearby";
import type { Quake } from "./types";

// The day's quakes around the Campi Flegrei and Naples, in the shape of /api/hazards/quakes.
const NOW = Date.parse("2026-10-10T09:00:00Z");
const quake = (over: Partial<Quake> & Pick<Quake, "id" | "mag" | "lat" | "lon" | "time">): Quake => ({
  magType: "Md",
  place: "Campi Flegrei",
  depthKm: 2.7,
  url: "https://example.org/quake",
  source: "INGV",
  alsoIn: [],
  felt: null,
  mmi: null,
  tsunami: false,
  alert: null,
  reviewed: true,
  ...over,
});
const NAPLES = { lat: 40.852, lon: 14.268 };
const hoursAgo = (h: number): number => NOW - h * 3_600_000;
const day: Quake[] = [
  quake({ id: "cf-4", mag: 4.4, lat: 40.827, lon: 14.139, time: hoursAgo(2) }),
  quake({ id: "cf-2", mag: 2.1, lat: 40.83, lon: 14.14, time: hoursAgo(1) }),
  quake({ id: "ischia-3", mag: 3.1, lat: 40.73, lon: 13.9, time: hoursAgo(5) }),
  quake({ id: "far-6", mag: 5.2, lat: 38.5, lon: 15.5, time: hoursAgo(3), place: "Southern Italy" }),
  quake({ id: "old-4", mag: 4.0, lat: 40.83, lon: 14.14, time: hoursAgo(30) }),
  quake({ id: "near-27", mag: 2.7, lat: 40.86, lon: 14.27, time: hoursAgo(0.2), place: "Naples" }),
];

describe("quakeItems", () => {
  test("a quake strong enough to be felt where you stand is a condition of your area", () => {
    const items = quakeItems(day, NAPLES, 1000, NOW, "metric");
    expect(items[0]).toMatchObject({ id: "cf-4", at: "here", tone: "sodium", title: "Earthquake M 4.4", primary: { label: "Details" } });
    expect(items[0]?.detail).toBe("Campi Flegrei · 2.7 km deep · 2h ago · may have been felt here");
    expect(items[0]?.entity).toMatchObject({ kind: "quake", id: "cf-4" });
  });

  test("a small quake inside the radius sits on the map; one outside is dropped", () => {
    const items = quakeItems(day, NAPLES, 3000, NOW, "metric");
    expect(items.find((i) => i.id === "near-27")).toMatchObject({ at: { lat: 40.86, lon: 14.27 } });
    expect(items.map((i) => i.id)).not.toContain("cf-2");
  });

  test("keeps the day only: felt first, then the strongest; a quake under M2.5 is never listed", () => {
    const items = quakeItems(day, { lat: 40.83, lon: 14.14 }, 30_000, NOW, "metric");
    expect(items.map((i) => i.id)).toEqual(["cf-4", "ischia-3", "near-27"]);
  });

  test("lists three at most", () => {
    const many = [...day, quake({ id: "extra", mag: 3.0, lat: 40.84, lon: 14.15, time: hoursAgo(4) })];
    expect(quakeItems(many, { lat: 40.83, lon: 14.14 }, 30_000, NOW, "metric")).toHaveLength(3);
  });

  test("a big quake far away is quiet, and M5 or more is alarm when felt", () => {
    expect(quakeItems(day, NAPLES, 8000, NOW, "metric").map((i) => i.id)).not.toContain("far-6");
    expect(quakeItems(day, { lat: 38.6, lon: 15.4 }, 1000, NOW, "metric")[0]).toMatchObject({ id: "far-6", at: "here", tone: "alarm" });
  });

  test("a tremor under M3 is never felt, and nothing near gives an empty list", () => {
    expect(quakeItems([quake({ id: "t", mag: 2.9, lat: 40.852, lon: 14.268, time: hoursAgo(1) })], NAPLES, 250, NOW, "metric")[0]?.at).not.toBe("here");
    expect(quakeItems(day, { lat: 52.37, lon: 4.9 }, 8000, NOW, "metric")).toEqual([]);
  });

  test("the felt radius grows with magnitude", () => {
    expect(Math.round(feltRadiusM(3))).toBe(10_000);
    expect(feltRadiusM(5)).toBeGreaterThan(feltRadiusM(4) * 3);
  });
});
