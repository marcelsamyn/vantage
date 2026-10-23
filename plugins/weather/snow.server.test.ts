import { expect, test } from "bun:test";
import { depthChange, type Reading } from "./snow.server";

/** Half-hourly snow depths from SLF IMIS, recorded on 2026-10-08 18:00 to 2026-10-09 00:30 UTC. */
const series = (depths: readonly (number | null)[]): Reading[] => depths.map((hs, i) => ({ t: Date.UTC(2026, 9, 8, 18) + i * 1_800_000, hs }));

const RECORDED = {
  // Bärentälli (2,558 m): snow started falling in the evening on top of noisy 1 to 8 cm readings.
  DAV2: [6.81, 2.14, 1.0, 3.14, 1.0, 8.36, 2.75, 7.34, 4.06, 4.95, 10.7, 9.64, 11.63, 11.98],
  // Tschitta: depth creeping up by about 3 cm in six hours.
  ELA2: [2.14, 3.16, 3.43, 3.6, 4.23, 4.59, 5.12, 5.5, 5.73, 5.69, 5.99, 5.86, 5.5, 5.49],
  // Engstligenalp: a settled pack with dropped readings.
  ADE2: [41.4, null, 39.55, 38.3, 38.0, 38.3, 37.8, 37.8, null, 37.13, 36.8, null, 39.8, 39.9],
  // A single 5.7 cm reading on bare ground.
  SMN2: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 5.7, 1.0, 1.0],
} as const;

test("snow that builds up within six hours is fresh, with the depth the median of the last three readings", () => {
  const change = depthChange(series(RECORDED.DAV2));
  expect(change?.fresh).toBe(true);
  expect(change?.depthCm).toBe(11.6);
  expect(change?.riseCm).toBeGreaterThanOrEqual(10);
});

test("slow creep, a settled pack and a single spike are not fresh snow", () => {
  expect(depthChange(series(RECORDED.ELA2))?.fresh).toBe(false);
  expect(depthChange(series(RECORDED.ADE2))).toMatchObject({ fresh: false, depthCm: 39.8 });
  expect(depthChange(series(RECORDED.SMN2))).toMatchObject({ fresh: false, depthCm: 1 });
});

test("melting never counts as a rise", () => {
  expect(depthChange(series([40, 38, 35, 33, 30, 28, 26, 24]))).toMatchObject({ riseCm: 0, fresh: false });
});

test("too few readings in the window say nothing about a rise", () => {
  expect(depthChange(series([0, 0, 12, 14]))).toMatchObject({ riseCm: 0, fresh: false });
});

test("a station with no depth readings has no depth", () => {
  expect(depthChange(series([null, null, null]))).toBeNull();
  expect(depthChange([])).toBeNull();
});
