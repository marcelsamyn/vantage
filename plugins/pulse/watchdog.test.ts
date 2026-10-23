import { describe, expect, test } from "bun:test";
import { backoffMs } from "./backoff";
import { Watchdog, type WatchdogOptions } from "./watchdog";

describe("backoffMs", () => {
  test("doubles from the base and stops at the cap", () => {
    expect([1, 2, 3, 4, 5, 6, 7].map((n) => backoffMs(n, 2_000, 60_000))).toEqual([2_000, 4_000, 8_000, 16_000, 32_000, 60_000, 60_000]);
  });

  test("treats zero failures as the first and survives huge counts", () => {
    expect(backoffMs(0, 1_000, 30_000)).toBe(1_000);
    expect(backoffMs(10_000, 1_000, 30_000)).toBe(30_000);
  });
});

const OPTIONS: WatchdogOptions = { pollMs: 2_000, silenceMs: 30_000, quietCheckMs: 15_000, maxBackoffMs: 60_000, maxWindowMs: 120_000 };

describe("Watchdog", () => {
  test("stays quiet while MQTT delivers", () => {
    const dog = new Watchdog(0, OPTIONS);
    expect(dog.begin(2_000, 1_500, false)).toBeNull();
    expect(dog.begin(40_000, 39_000, false)).toBeNull();
  });

  test("after hours of healthy MQTT, the first poll asks only for the recent past", () => {
    const hours = 6 * 3_600_000;
    const dog = new Watchdog(0, OPTIONS);
    for (let t = 2_000; t < hours; t += 2_000) dog.begin(t, t - 500, false);
    const now = hours + 31_000;
    const since = dog.begin(now, hours - 500, false);
    expect(since).not.toBeNull();
    expect(now - (since ?? 0)).toBeLessThanOrEqual(OPTIONS.maxWindowMs);
    // The silent half minute is covered.
    expect(since).toBeLessThanOrEqual(hours - 500);
  });

  test("never starts a second poll while one runs", () => {
    const dog = new Watchdog(0, OPTIONS);
    expect(dog.begin(40_000, 0, false)).not.toBeNull();
    expect(dog.begin(42_000, 0, true)).toBeNull();
    expect(dog.begin(60_000, 0, true)).toBeNull();
    dog.succeeded();
    expect(dog.begin(62_000, 0, true)).not.toBeNull();
  });

  test("checks a silent broker every quietCheckMs, not every tick", () => {
    const dog = new Watchdog(0, OPTIONS);
    expect(dog.begin(40_000, 0, false)).not.toBeNull();
    dog.succeeded();
    expect(dog.begin(42_000, 0, false)).toBeNull();
    expect(dog.begin(54_000, 0, false)).toBeNull();
    expect(dog.begin(55_000, 0, false)).not.toBeNull();
  });

  test("backs off after each failure up to the cap, and starts over after a success", () => {
    const dog = new Watchdog(0, OPTIONS);
    /** Ticks every 2 s until a poll may start; returns when, and fails that poll. */
    const nextPoll = (after: number): number => {
      let now = after;
      do now += 2_000;
      while (dog.begin(now, 0, true) === null);
      dog.failed(now);
      return now;
    };
    expect(dog.begin(40_000, 0, true)).not.toBeNull();
    dog.failed(40_000);
    const gaps: number[] = [];
    let at = 40_000;
    for (let i = 0; i < 7; i++) {
      const next = nextPoll(at);
      gaps.push(next - at);
      at = next;
    }
    expect(gaps).toEqual([2_000, 4_000, 8_000, 16_000, 32_000, 60_000, 60_000]);

    // A poll that works clears the penalty.
    const healed = at + 60_000;
    expect(dog.begin(healed, 0, true)).not.toBeNull();
    dog.succeeded();
    expect(dog.begin(healed + 2_000, 0, true)).not.toBeNull();
    dog.failed(healed + 2_000);
    expect(dog.begin(healed + 3_000, 0, true)).toBeNull();
    expect(dog.begin(healed + 4_000, 0, true)).not.toBeNull();
  });
});
