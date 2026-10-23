import { describe, expect, test } from "bun:test";
import { auroraItems } from "./nearby";
import type { AuroraPoint } from "./types";

// The storm of 11 May 2024 pushed the oval far south; a quiet night keeps it above 60°.
const storm: AuroraPoint = { observedAt: 1_715_390_000_000, forecastAt: 1_715_393_600_000, chancePct: 64, peakPct: 100, edgeLat: 47, reachLat: 42 };
const quiet: AuroraPoint = { ...storm, chancePct: 0, peakPct: 38, edgeLat: 64, reachLat: 60 };
const BRUSSELS = { lat: 50.85, lon: 4.35 };
const MIDNIGHT = Date.parse("2024-05-11T23:30:00Z");
const NOON = Date.parse("2024-05-11T11:00:00Z");

describe("auroraItems", () => {
  test("a high chance overhead in the dark is one item for your area", () => {
    const items = auroraItems(storm, BRUSSELS, MIDNIGHT);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ at: "here", kind: "see", tone: "mint", live: true, detail: "64 % chance overhead" });
  });

  test("when only the horizon reaches you, it says where to look", () => {
    const edge: AuroraPoint = { ...storm, chancePct: 3, reachLat: 49 };
    expect(auroraItems(edge, BRUSSELS, MIDNIGHT)[0]?.detail).toBe("Look low on the northern horizon");
    expect(auroraItems({ ...edge, reachLat: -52 }, { lat: -53.5, lon: -10 }, MIDNIGHT)[0]?.detail).toBe("Look low on the southern horizon");
  });

  test("stays quiet when the oval is far north", () => {
    expect(auroraItems(quiet, BRUSSELS, MIDNIGHT)).toEqual([]);
    expect(auroraItems({ ...quiet, reachLat: null }, BRUSSELS, MIDNIGHT)).toEqual([]);
  });

  test("stays quiet in daylight, even under the oval", () => {
    expect(auroraItems(storm, BRUSSELS, NOON)).toEqual([]);
  });

  test("a chance of exactly 10 % counts", () => {
    expect(auroraItems({ ...quiet, chancePct: 10 }, BRUSSELS, MIDNIGHT)).toHaveLength(1);
  });
});
