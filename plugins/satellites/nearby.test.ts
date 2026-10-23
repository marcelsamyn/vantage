import { describe, expect, test } from "bun:test";
import { passItem } from "./nearby";
import type { Pass } from "./client";
import type { SatelliteRef } from "./types";

const iss: SatelliteRef = {
  name: "ISS (ZARYA)",
  norad: 25544,
  line1: "1 25544U 98067A   26282.50000000  .00010000  00000-0  18000-3 0  9990",
  line2: "2 25544  51.6400 120.0000 0005000  80.0000 280.0000 15.50000000400000",
  group: "stations",
};
const pass: Pass = {
  rise: new Date("2026-10-09T19:41:00Z"),
  riseAz: 250,
  peak: new Date("2026-10-09T19:44:00Z"),
  peakEl: 62,
  peakAz: 170,
  set: new Date("2026-10-09T19:47:00Z"),
  setAz: 95,
  visible: true,
};

describe("passItem", () => {
  test("a pass is something to see overhead: Open the sky is the only action", () => {
    const item = passItem(iss, pass);
    expect(item).toMatchObject({ kind: "see", at: "overhead", title: "ISS passes over", startsAt: pass.rise.getTime(), until: pass.set.getTime(), primary: { label: "Open the sky" } });
    expect(item.more).toBeUndefined();
  });
});
