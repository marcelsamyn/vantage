import { describe, expect, test } from "bun:test";
import { liveStations } from "./gauges.server";

const NOW = Date.UTC(2026, 9, 9, 0, 30, 0);

/** A row as the IOC station list sends it. */
const row = (patch: Record<string, unknown> = {}) => ({
  Code: "CI20",
  Location: "Civitavecchia",
  countryname: "Italy",
  lat: 42.094,
  lon: 11.79,
  sensor: "rad",
  units: "M",
  rate: 1,
  lasttime: "2026-10-09 00:29:30.000",
  lastvalue: -0.016,
  ...patch,
});

describe("live gauges in the IOC station list", () => {
  test("a gauge that reported a minute ago comes through with its name, country, interval and UTC time", () => {
    const [gauge] = liveStations([row()], NOW);
    expect(gauge).toMatchObject({ code: "CI20", name: "Civitavecchia", country: "Italy", intervalMin: 1, valueM: -0.016, sensor: "rad" });
    expect(gauge?.at).toBe(Date.UTC(2026, 9, 9, 0, 29, 30));
  });

  test("battery and air-pressure sensors, and readings that are not in metres, are not sea level", () => {
    const rows = [row({ Code: "A", sensor: "bat", units: "V" }), row({ Code: "B", sensor: "atm" }), row({ Code: "C", units: "F" }), row({ Code: "D", sensor: null })];
    expect(liveStations(rows, NOW)).toEqual([]);
  });

  test("a gauge silent for more than six hours is offline", () => {
    expect(liveStations([row({ lasttime: "2026-10-08 18:00:00.000" })], NOW)).toEqual([]);
    expect(liveStations([row({ lasttime: "2026-10-08 19:00:00.000" })], NOW)).toHaveLength(1);
  });

  test("no-data values and impossible heights drop the gauge instead of showing a fake level", () => {
    for (const lastvalue of [-999, -1, 80.5, null]) expect(liveStations([row({ lastvalue })], NOW)).toEqual([]);
  });

  test("a gauge without a position or a time cannot be placed", () => {
    expect(liveStations([row({ lat: null }), row({ lon: null }), row({ lasttime: null })], NOW)).toEqual([]);
  });

  test("fractions of a minute are kept: a gauge that reports every 15 seconds says so", () => {
    expect(liveStations([row({ rate: 0.25 })], NOW)[0]?.intervalMin).toBe(0.25);
  });
});
