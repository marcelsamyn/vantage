import { describe, expect, test } from "bun:test";
import { filteredHeading, headingOf, orientationOf, smoothHeading, turnDeg, unwrapDeg, type HeadingFilter } from "./heading";

/** Feed readings 16 ms apart, as a phone's sensor sends them, and return the filter. */
function feed(readings: readonly number[], start: HeadingFilter | null = null): HeadingFilter | null {
  let f = start;
  let t = start?.t ?? 0;
  for (const deg of readings) {
    t += 16;
    f = smoothHeading(f, deg, t);
  }
  return f;
}

describe("smoothHeading", () => {
  test("averages across north on the circle: 359° and 1° settle on 0°, never near 180°", () => {
    const f = feed([359, 1, 359, 1, 359, 1, 359, 1]);
    if (!f) throw new Error("no filter");
    const h = filteredHeading(f);
    expect(Math.abs(turnDeg(0, h))).toBeLessThan(1.5);
  });

  test("a turn from 350° to 10° goes the short way through north", () => {
    let f = feed([350, 350, 350]);
    const seen: number[] = [];
    for (let i = 0; i < 60; i++) {
      f = feed([10], f);
      if (f) seen.push(filteredHeading(f));
    }
    expect(seen.every((h) => h >= 350 || h <= 10)).toBe(true);
    expect(seen[seen.length - 1]).toBeCloseTo(10, 0);
  });

  test("calms a shaky hand: one reading 40° off moves the heading only a little", () => {
    const f = feed([90, 90, 90, 90, 130]);
    if (!f) throw new Error("no filter");
    expect(filteredHeading(f)).toBeGreaterThan(90);
    expect(filteredHeading(f)).toBeLessThan(97);
  });

  test("a reading after a long pause counts fully", () => {
    const f = smoothHeading(smoothHeading(null, 90, 0), 200, 5000);
    expect(filteredHeading(f)).toBeCloseTo(200, 0);
  });
});

describe("headingOf", () => {
  test("iOS: the compass heading, plus how far the screen is turned", () => {
    expect(headingOf({ webkitCompassHeading: 45, alpha: 300, absolute: false }, 0)).toBe(45);
    expect(headingOf({ webkitCompassHeading: 300, alpha: null, absolute: false }, 90)).toBe(30);
  });

  test("other browsers: an absolute alpha turns the other way round", () => {
    expect(headingOf({ alpha: 90, absolute: true }, 0)).toBe(270);
    expect(headingOf({ alpha: 0, absolute: true }, 0)).toBe(0);
  });

  test("a relative reading says nothing about north", () => {
    expect(headingOf({ alpha: 90, absolute: false }, 0)).toBeNull();
    expect(headingOf({ alpha: null, absolute: true }, 0)).toBeNull();
  });

  test("heading follows the back of an upright landscape phone", () => {
    expect(headingOf({ alpha: 0, beta: 0, gamma: -90, absolute: true }, 90)).toBeCloseTo(90);
    expect(headingOf({ alpha: 0, beta: 120, gamma: 0, absolute: true }, 0)).toBeCloseTo(0);
  });

  test("pointing higher keeps the same heading, with a yaw fallback at the zenith", () => {
    for (const beta of [134, 136, 179, 180]) {
      expect(headingOf({ alpha: 315, beta, gamma: 0, absolute: true }, 0)).toBeCloseTo(45);
    }
  });

  test("flat phones use the displayed top edge in either landscape orientation", () => {
    expect(headingOf({ alpha: 0, beta: 0, gamma: 0, absolute: true }, 90)).toBeCloseTo(90);
    expect(headingOf({ alpha: 0, beta: 0, gamma: 0, absolute: true }, 270)).toBeCloseTo(270);
  });
});

test("an unwrapped angle keeps turning past 360°, so a rotation never spins the long way", () => {
  expect(unwrapDeg(null, 370)).toBe(10);
  expect(unwrapDeg(359, 1)).toBe(361);
  expect(unwrapDeg(361, 350)).toBe(350);
  expect(unwrapDeg(10, 190)).toBe(190);
});

describe("orientationOf", () => {
  test("the back of an upright phone points north, and a face-down phone points up", () => {
    const upright = orientationOf({ alpha: 0, beta: 90, gamma: 0, absolute: true }, 0);
    expect(upright?.forward[0]).toBeCloseTo(0);
    expect(upright?.forward[1]).toBeCloseTo(1);
    expect(upright?.forward[2]).toBeCloseTo(0);
    expect(upright?.up[2]).toBeCloseTo(1);
    expect(orientationOf({ alpha: 0, beta: 180, gamma: 0, absolute: true }, 0)?.forward[2]).toBeCloseTo(1);
  });

  test("landscape rotates the screen axes but keeps the same sight direction", () => {
    for (const [gamma, angle, east] of [[-90, 90, 1], [90, 270, -1]] as const) {
      const pose = orientationOf({ alpha: 0, beta: 0, gamma, absolute: true }, angle);
      expect(pose?.forward[0]).toBeCloseTo(east);
      expect(pose?.right[1]).toBeCloseTo(-east);
      expect(pose?.up[2]).toBeCloseTo(1);
    }
  });

  test("Safari uses its compass rather than its relative alpha", () => {
    const pose = orientationOf({ webkitCompassHeading: 90, alpha: 37, beta: 90, gamma: 0, absolute: false }, 0);
    expect(pose?.forward[0]).toBeCloseTo(1);
    expect(pose?.forward[1]).toBeCloseTo(0);
  });

  test("missing tilt, relative north, and invalid compass readings stay unknown", () => {
    expect(orientationOf({ alpha: 0, beta: null, gamma: 0, absolute: true }, 0)).toBeNull();
    expect(orientationOf({ alpha: 0, beta: 90, gamma: 0, absolute: false }, 0)).toBeNull();
    expect(orientationOf({ webkitCompassHeading: -1, alpha: 0, beta: 90, gamma: 0, absolute: false }, 0)).toBeNull();
  });
});
