import { describe, expect, test } from "bun:test";
import { BeaconTracker, CONFIRM_MS } from "./tracker";

const tone = { frequency: 19_000, db: -40, prominence: 30 };

describe("BeaconTracker", () => {
  test("stamps a detection with wall-clock time and measures its length on the frame clock", () => {
    const tracker = new BeaconTracker();
    // Frame times are small numbers from a loop clock, nowhere near Date.now().
    const before = Date.now();
    tracker.update(10, [tone]);
    const events = tracker.update(10 + CONFIRM_MS, [tone]);
    expect(events).toHaveLength(1);
    expect(events[0]?.startedAt).toBeGreaterThanOrEqual(before);
    expect(events[0]?.startedAt).toBeLessThanOrEqual(Date.now());
    expect(events[0]?.durationMs).toBe(CONFIRM_MS);
  });
});
