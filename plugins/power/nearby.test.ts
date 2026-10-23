import { describe, expect, test } from "bun:test";
import { cutItems } from "./nearby";
import type { PowerCut, PowerCuts } from "./types";

// Liander cuts in Amsterdam, in the shape of /api/power/cuts: one fault under Oost, planned work in the west, a fixed cut and a far fault.
const cut = (over: Partial<PowerCut> & Pick<PowerCut, "id" | "lat" | "lon">): PowerCut => ({
  type: "fault",
  status: "on-site",
  statusText: "Crew on site",
  causeText: "Digging work",
  customers: "fewer than 100",
  streets: ["Linnaeusstraat"],
  reported: 1_791_540_000,
  estimatedFix: null,
  fixed: null,
  ...over,
});
const square = (lat: number, lon: number, half: number): GeoJSON.Polygon => ({
  type: "Polygon",
  coordinates: [
    [
      [lon - half, lat - half],
      [lon + half, lat - half],
      [lon + half, lat + half],
      [lon - half, lat + half],
      [lon - half, lat - half],
    ],
  ],
});
const data: PowerCuts = {
  at: 1_791_541_000,
  cuts: [
    cut({ id: "fault-oost", lat: 52.3599, lon: 4.9157 }),
    cut({ id: "planned-west", lat: 52.3731, lon: 4.8422, type: "planned", status: "pending", statusText: "Planned", streets: ["Kerkstraat", "Prinsengracht"] }),
    cut({ id: "fixed-centrum", lat: 52.3702, lon: 4.8952, status: "fixed", statusText: "Fixed", fixed: 1_791_539_000 }),
    cut({ id: "fault-zuid", lat: 52.34, lon: 4.9, streets: [] }),
  ],
  areas: {
    type: "FeatureCollection",
    features: [
      { type: "Feature", properties: { id: "fault-oost" }, geometry: square(52.3599, 4.9157, 0.002) },
      { type: "Feature", properties: { id: "planned-west" }, geometry: square(52.3731, 4.8422, 0.002) },
      { type: "Feature", properties: { id: "fixed-centrum" }, geometry: square(52.3702, 4.8952, 0.002) },
      { type: "Feature", properties: { id: "fault-zuid" }, geometry: square(52.34, 4.9, 0.002) },
    ],
  },
};

describe("cutItems", () => {
  test("standing inside a cut's area makes it a condition of your area", () => {
    const items = cutItems(data, { lat: 52.3601, lon: 4.9155 }, 500);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: "fault-oost", at: "here", kind: "see", tone: "alarm", live: true, title: "Power cut on Linnaeusstraat", primary: { label: "Details" } });
    expect(items[0]?.detail).toBe("Power cut · Crew on site · fewer than 100 customers");
    expect(items[0]?.entity).toMatchObject({ kind: "powercut", id: "fault-oost" });
  });

  test("a cut next door is placed on the map, planned work in sodium", () => {
    const items = cutItems(data, { lat: 52.3735, lon: 4.8480 }, 1000);
    expect(items[0]).toMatchObject({ id: "planned-west", at: { lat: 52.3731, lon: 4.8422 }, tone: "sodium", title: "Planned work on Kerkstraat and 1 more" });
  });

  test("your own cut comes before a nearer one that does not hold your spot", () => {
    const wide: PowerCuts = { ...data, areas: { ...data.areas, features: data.areas.features.map((f) => (f.properties?.id === "fault-oost" ? { ...f, geometry: square(52.3599, 4.9157, 0.02) } : f)) } };
    const items = cutItems(wide, { lat: 52.3402, lon: 4.91 }, 2500);
    expect(items.map((i) => i.id)).toEqual(["fault-oost", "fault-zuid"]);
    expect(items[0]?.at).toBe("here");
  });

  test("never lists a fixed cut", () => {
    expect(cutItems(data, { lat: 52.3702, lon: 4.8952 }, 1000)).toEqual([]);
  });

  test("nothing near and a cut without streets still has a title", () => {
    expect(cutItems(data, { lat: 52.5, lon: 5.2 }, 8000)).toEqual([]);
    expect(cutItems(data, { lat: 52.34, lon: 4.9 }, 250)[0]?.title).toBe("Power cut");
  });

  test("a spot inside a hole of the area is not inside the cut", () => {
    const ring = square(52.36, 4.9, 0.004).coordinates[0] ?? [];
    const holed: PowerCuts = {
      ...data,
      cuts: [cut({ id: "ring", lat: 52.36, lon: 4.9 })],
      areas: { type: "FeatureCollection", features: [{ type: "Feature", properties: { id: "ring" }, geometry: { type: "Polygon", coordinates: [ring, square(52.36, 4.9, 0.001).coordinates[0] ?? []] } }] },
    };
    expect(cutItems(holed, { lat: 52.36, lon: 4.9 }, 10)[0]?.at).not.toBe("here");
    expect(cutItems(holed, { lat: 52.3625, lon: 4.9 }, 10)[0]?.at).toBe("here");
  });
});
