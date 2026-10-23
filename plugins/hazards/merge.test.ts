import { describe, expect, test } from "bun:test";
import { mergeQuakes } from "./merge";
import type { Quake, QuakeSource } from "./types";

const T0 = Date.UTC(2026, 9, 8, 12, 0, 0);

function quake(source: QuakeSource, over: Partial<Quake> = {}): Quake {
  return {
    id: `${source}:${Math.random()}`,
    mag: 3,
    magType: "ml",
    place: "somewhere",
    time: T0,
    lat: 40.83,
    lon: 14.14,
    depthKm: 3,
    url: "",
    source,
    alsoIn: [],
    felt: null,
    mmi: null,
    tsunami: false,
    alert: null,
    reviewed: null,
    ...over,
  };
}

describe("mergeQuakes", () => {
  test("the same Campi Flegrei quake from three services becomes one, kept from INGV", () => {
    const merged = mergeQuakes(
      [quake("USGS", { time: T0 + 8_000, lat: 40.85, lon: 14.12, mag: 3.1, felt: 120, mmi: 4.2, alert: "green" })],
      [quake("EMSC", { time: T0 + 2_000, lat: 40.84, lon: 14.15, mag: 3.0 })],
      [quake("INGV", { time: T0, mag: 2.9, place: "2 km SW Pozzuoli (NA)" })],
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ source: "INGV", place: "2 km SW Pozzuoli (NA)", mag: 2.9, felt: 120, mmi: 4.2, alert: "green" });
    expect([...(merged[0]?.alsoIn ?? [])].sort()).toEqual(["EMSC", "USGS"]);
  });

  test("outside Italy EMSC's local agencies win over USGS", () => {
    const merged = mergeQuakes([quake("USGS", { lat: 50.5, lon: 5.9, time: T0 + 5_000 })], [quake("EMSC", { lat: 50.52, lon: 5.88, place: "BELGIUM" })]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.source).toBe("EMSC");
  });

  test("a micro-quake only INGV reports stays in the list", () => {
    const merged = mergeQuakes([quake("USGS", { mag: 4.5, lat: 38.2, lon: 15.0, time: T0 - 3_600_000 })], [quake("INGV", { mag: 0.8 })]);
    expect(merged).toHaveLength(2);
    expect(merged.map((q) => q.source)).toEqual(["INGV", "USGS"]);
  });

  test("two quakes seconds apart in the same service are never merged, even when another service lists one", () => {
    const merged = mergeQuakes([quake("INGV", { time: T0, mag: 2.2 }), quake("INGV", { time: T0 + 40_000, mag: 2.4 })], [quake("USGS", { time: T0 + 10_000, mag: 2.3 })]);
    expect(merged).toHaveLength(2);
    expect(merged.filter((q) => q.source === "INGV")).toHaveLength(2);
  });

  test("quakes far apart or minutes apart stay separate", () => {
    const merged = mergeQuakes([quake("USGS", { lat: 36, lon: 140, time: T0 })], [quake("EMSC", { lat: 40.8, lon: 14.1, time: T0 })], [quake("INGV", { time: T0 + 300_000 })]);
    expect(merged).toHaveLength(3);
  });

  test("a big difference in magnitude means a different event", () => {
    const merged = mergeQuakes([quake("USGS", { mag: 5.6 })], [quake("EMSC", { mag: 2.1 })]);
    expect(merged).toHaveLength(2);
  });

  test("the result is newest first", () => {
    const merged = mergeQuakes([quake("USGS", { time: T0 - 1_000_000, lat: 10, lon: 10 }), quake("USGS", { time: T0, lat: 20, lon: 20 })]);
    expect(merged.map((q) => q.time)).toEqual([T0, T0 - 1_000_000]);
  });
});
