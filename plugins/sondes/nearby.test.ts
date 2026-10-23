import { describe, expect, test } from "bun:test";
import { balloonItems, sondeItems } from "./nearby";
import type { AmateurBalloon, Sonde, SondeSnapshot } from "./types";

// Balloons over Belgium, shaped like /api/sondes/live and /api/sondes/balloons answered on 9 October 2026.
const NOW = Date.UTC(2026, 9, 9, 11, 30);
const UCCLE = { lat: 50.7993, lon: 4.3586 };

const flying: Sonde = {
  serial: "W4214270",
  type: "RS41",
  subtype: "RS41-SGP",
  manufacturer: "Vaisala",
  lat: 50.82,
  lon: 4.36,
  altM: 18_400,
  speedMs: 0,
  vertMs: 0,
  headingDeg: null,
  tempC: -58,
  humidityPct: null,
  pressureHpa: 74,
  frequencyMHz: 403.5,
  battV: 2.7,
  seenAt: NOW - 20_000,
  phase: "ascending",
  prediction: null,
};
const snapshot = (...sondes: Sonde[]): SondeSnapshot => ({ fetchedAt: NOW - 10_000, predictionsAvailable: true, sondes });

describe("sondeItems", () => {
  test("a balloon in the sky is live, with its model and height", () => {
    const [item] = sondeItems(snapshot(flying), UCCLE, 5000, NOW, "metric");
    expect(item).toMatchObject({ id: "W4214270", title: "Radiosonde W4214270", detail: "Vaisala RS41-SGP · 18.4 km up · ascending", kind: "see", tone: "sodium", live: true });
    expect(item?.entity).toMatchObject({ kind: "sonde", id: "W4214270", data: { fetchedAt: NOW - 10_000 } });
  });

  test("height follows the imperial setting", () => {
    expect(sondeItems(snapshot(flying), UCCLE, 5000, NOW, "imperial")[0]?.detail).toContain("60,367 ft up");
  });

  test("a balloon on the ground is not live and names its frequency", () => {
    const landed: Sonde = { ...flying, phase: "ground", altM: 80, vertMs: 0 };
    expect(sondeItems(snapshot(landed), UCCLE, 5000, NOW, "metric")[0]).toMatchObject({ detail: "Vaisala RS41-SGP · on the ground · 403.500 MHz", tone: "fog" });
    expect(sondeItems(snapshot(landed), UCCLE, 5000, NOW, "metric")[0]?.live).toBeUndefined();
  });

  test("a balloon that is out of range but will land within the radius is placed at its landing", () => {
    const landing = { lat: 50.81, lon: 4.35, altM: 90, at: NOW + 9 * 60_000 };
    const coming: Sonde = { ...flying, lat: 50.95, lon: 4.6, altM: 6000, vertMs: -8, phase: "descending", speedMs: 0, prediction: { updatedAt: NOW, path: [], burst: null, landing } };
    const [item] = sondeItems(snapshot(coming), UCCLE, 5000, NOW, "metric");
    expect(item?.at).toEqual({ lat: 50.81, lon: 4.35 });
    expect(item?.detail).toContain("lands about");
  });

  test("ignores a balloon that is lost, or far away and landing far away", () => {
    expect(sondeItems(snapshot({ ...flying, phase: "lost" }), UCCLE, 5000, NOW, "metric")).toEqual([]);
    expect(sondeItems(snapshot({ ...flying, lat: 51.5 }), UCCLE, 5000, NOW, "metric")).toEqual([]);
  });

  test("returns nothing for an empty feed, and keeps three at most, nearest first", () => {
    expect(sondeItems(snapshot(), UCCLE, 5000, NOW, "metric")).toEqual([]);
    const many = Array.from({ length: 5 }, (_, i): Sonde => ({ ...flying, serial: `S${i}`, lat: 50.7993 + (4 - i) * 0.002 }));
    expect(sondeItems(snapshot(...many), UCCLE, 5000, NOW, "metric").map((i) => i.id)).toEqual(["S4", "S3", "S2"]);
  });
});

const drifter: AmateurBalloon = { id: "b7f3a1", name: "WSPR balloon b7f3a1", link: "WSPR", lat: 50.81, lon: 4.37, altM: 12_300, speedMs: 19.5, tempC: -41, frequencyMHz: 14.097, daysAloft: 555, launchDate: "2025-04-02", seenAt: NOW - 8 * 60_000, track: [] };

describe("balloonItems", () => {
  test("a balloon heard minutes ago is live", () => {
    expect(balloonItems([drifter], UCCLE, 5000, NOW, "metric")[0]).toMatchObject({ id: "b7f3a1", title: "WSPR balloon b7f3a1", detail: "WSPR · 12.3 km · day 555 aloft", tone: "sodium", live: true });
  });

  test("a balloon last heard hours ago says so and is not live", () => {
    const quiet = { ...drifter, seenAt: NOW - 3 * 3_600_000 };
    expect(balloonItems([quiet], UCCLE, 5000, NOW, "metric")[0]).toMatchObject({ detail: "WSPR · 12.3 km · day 555 aloft · heard 3h ago", tone: "fog" });
  });

  test("drops a balloon not heard for six hours, or beyond the radius", () => {
    expect(balloonItems([{ ...drifter, seenAt: NOW - 6 * 3_600_000 - 1 }], UCCLE, 5000, NOW, "metric")).toEqual([]);
    expect(balloonItems([{ ...drifter, lat: 51.4 }], UCCLE, 5000, NOW, "metric")).toEqual([]);
  });

  test("a balloon without a launch registry entry shows no age", () => {
    expect(balloonItems([{ ...drifter, daysAloft: null }], UCCLE, 5000, NOW, "metric")[0]?.detail).toBe("WSPR · 12.3 km");
  });
});
