import { describe, expect, test } from "bun:test";
import { boxAround, shipItems } from "./nearby";
import type { Vessel } from "./types";

// Vessels in the Gulf of Finland off Helsinki, shaped like /api/ships/near answered on 9 October 2026.
const HELSINKI = { lat: 60.1675, lon: 24.9558 };
const AT = Date.UTC(2026, 9, 9, 8, 0);

const ferry: Vessel = { mmsi: 230994000, name: "FINLANDIA", lat: 60.1601, lon: 24.9702, sogKt: 14.2, cogDeg: 281, headingDeg: 280, navStatus: 0, shipType: 69, category: "passenger", flag: "Finland", at: AT, source: "digitraffic" };
const moored: Vessel = { ...ferry, mmsi: 230123000, name: "TALLINK STAR", lat: 60.1651, lon: 24.9601, sogKt: 0.1, navStatus: 5 };
const cargo: Vessel = { ...ferry, mmsi: 257123456, name: null, lat: 60.1402, lon: 24.9811, sogKt: null, navStatus: null, shipType: null, category: "other", flag: null };
const far: Vessel = { ...ferry, mmsi: 265000111, name: "FAR AWAY", lat: 59.9, lon: 24.5 };

describe("shipItems", () => {
  test("lists ships nearest first with type, speed and flag", () => {
    const items = shipItems([cargo, ferry, moored], HELSINKI, 5000, "metric");
    expect(items.map((i) => i.title)).toEqual(["TALLINK STAR", "FINLANDIA", "MMSI 257123456"]);
    expect(items[1]).toMatchObject({ id: "230994000", kind: "see", tone: "sodium", live: true, detail: "Passenger ship · 26 km/h · Finland" });
    expect(items[1]?.entity).toMatchObject({ kind: "ship", id: "230994000" });
    expect(items[1]?.primary.label).toBe("Show ship");
  });

  test("a ship lying still says what its status is", () => {
    expect(shipItems([moored], HELSINKI, 5000, "metric")[0]?.detail).toBe("Passenger ship · Moored · Finland");
  });

  test("a ship that sent no speed, status, type or flag still gets a plain line", () => {
    expect(shipItems([cargo], HELSINKI, 5000, "metric")[0]?.detail).toBe("Vessel · Not moving");
  });

  test("speed follows the imperial setting", () => {
    expect(shipItems([ferry], HELSINKI, 5000, "imperial")[0]?.detail).toContain("16 mph");
  });

  test("drops ships beyond the radius and keeps the nearest five", () => {
    expect(shipItems([far], HELSINKI, 5000, "metric")).toEqual([]);
    const fleet = Array.from({ length: 8 }, (_, i): Vessel => ({ ...ferry, mmsi: 230000000 + i, lat: 60.1675 + i * 0.001 }));
    expect(shipItems(fleet, HELSINKI, 5000, "metric").map((i) => i.id)).toEqual(["230000000", "230000001", "230000002", "230000003", "230000004"]);
  });

  test("returns nothing when there are no ships", () => {
    expect(shipItems([], HELSINKI, 1000, "metric")).toEqual([]);
  });
});

describe("boxAround", () => {
  test("holds the whole radius", () => {
    const box = boxAround(HELSINKI, 2000);
    expect(box.north - HELSINKI.lat).toBeCloseTo(0.018, 3);
    expect(HELSINKI.lat - box.south).toBeCloseTo(0.018, 3);
    expect(box.east).toBeGreaterThan(HELSINKI.lon);
    expect(box.west).toBeLessThan(HELSINKI.lon);
  });
});
