import { describe, expect, test } from "bun:test";
import { brightnessNote, headingOf, kmh, massComparison, massText, showerLabel, trackKm } from "./meteor-facts";
import type { Meteor } from "./types";

const meteor = (over: Partial<Meteor> = {}): Meteor => ({
  id: "20261007024501_LdiWn",
  at: 0,
  shower: null,
  showerName: null,
  begin: { lat: 45.4, lon: 19.6, heightKm: 125.9 },
  end: { lat: 45.7, lon: 19, heightKm: 82.9 },
  speedKms: 69,
  durationS: 1,
  peakMag: -5.8,
  massKg: 0.00586,
  cameras: 9,
  europe: true,
  ...over,
});

describe("trackKm", () => {
  test("combines the ground track and the drop in height", () => {
    // 0.3° of latitude and 0.6° of longitude at 45°N is 57 km on the ground, and the height drops by 43 km.
    expect(trackKm(meteor())).toBeCloseTo(71.7, 0);
  });

  test("a meteor that falls straight down still has a length", () => {
    expect(trackKm(meteor({ end: { lat: 45.4, lon: 19.6, heightKm: 85.9 } }))).toBeCloseTo(40, 3);
  });
});

describe("headingOf", () => {
  test("names the compass point the meteor moved towards", () => {
    expect(headingOf(meteor())).toBe("NW");
  });

  test("gives nothing when the ground track is shorter than half a kilometre", () => {
    expect(headingOf(meteor({ end: { lat: 45.4001, lon: 19.6001, heightKm: 90 } }))).toBeNull();
  });
});

describe("mass", () => {
  test("uses milligrams below a gram and grams above", () => {
    expect(massText(0.0000027)).toBe("2.7 mg");
    expect(massText(0.000047)).toBe("47 mg");
    expect(massText(0.00586)).toBe("5.9 g");
    expect(massText(0.0453)).toBe("45 g");
  });

  test("compares with things you have held", () => {
    expect(massComparison(0.000002)).toBe("a grain of sand");
    expect(massComparison(0.00002)).toBe("a grain of rice");
    expect(massComparison(0.00586)).toBe("a coin");
  });
});

describe("words", () => {
  test("brightness runs from fireball to faint", () => {
    expect(brightnessNote(-5.78)).toContain("brighter than Venus");
    expect(brightnessNote(1.9)).toContain("visible star");
    expect(brightnessNote(4.5)).toContain("faint");
  });

  test("a shower code without a name is still labelled, and no shower means sporadic", () => {
    expect(showerLabel(meteor({ shower: "STA", showerName: "Southern Taurids" }))).toBe("Southern Taurids");
    expect(showerLabel(meteor({ shower: "ZZZ" }))).toBe("Shower ZZZ");
    expect(showerLabel(meteor())).toBe("Sporadic meteor");
  });

  test("speed in km/h", () => {
    expect(kmh(69.4)).toBe(249_840);
  });
});
