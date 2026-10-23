import { describe, expect, test } from "bun:test";
import { decideMotion, IDLE_MS, MAX_FRAME_S, stepFrame } from "./motion";

const seen = { visible: true, reducedMotion: false, lastInput: 1_000 };

describe("decideMotion", () => {
  test("runs after input and says when it would rest", () => {
    expect(decideMotion(seen, 1_000)).toEqual({ motion: "run", recheckInMs: IDLE_MS });
    expect(decideMotion(seen, 61_000)).toEqual({ motion: "run", recheckInMs: IDLE_MS - 60_000 });
  });

  test("rests once the idle period has passed, and stays at rest without a timer", () => {
    expect(decideMotion(seen, 1_000 + IDLE_MS)).toEqual({ motion: "rest", recheckInMs: null });
    expect(decideMotion(seen, 1_000 + 10 * IDLE_MS)).toEqual({ motion: "rest", recheckInMs: null });
  });

  test("rests while hidden, however recent the input", () => {
    expect(decideMotion({ ...seen, visible: false }, 1_001)).toEqual({ motion: "rest", recheckInMs: null });
  });

  test("rests under reduced motion", () => {
    expect(decideMotion({ ...seen, reducedMotion: true }, 1_001)).toEqual({ motion: "rest", recheckInMs: null });
  });

  test("new input after a rest runs again for a full period", () => {
    const later = 1_000 + 3 * IDLE_MS;
    expect(decideMotion(seen, later).motion).toBe("rest");
    expect(decideMotion({ ...seen, lastInput: later }, later)).toEqual({ motion: "run", recheckInMs: IDLE_MS });
  });

  test("honours a custom idle period", () => {
    expect(decideMotion(seen, 1_500, 1_000)).toEqual({ motion: "run", recheckInMs: 500 });
    expect(decideMotion(seen, 2_000, 1_000).motion).toBe("rest");
  });
});

describe("stepFrame", () => {
  test("the first frame of a run has no step and starts the clock at the frame time", () => {
    expect(stepFrame(null, null, 5_000)).toEqual({ dt: 0, clock: 5_000 });
  });

  test("the clock advances by the capped step, while the frame time keeps its own timeline", () => {
    expect(stepFrame(5_000, 5_000, 5_016)).toEqual({ dt: 0.016, clock: 5_016 });
    const stalled = stepFrame(5_016, 5_016, 25_016);
    expect(stalled.dt).toBe(MAX_FRAME_S);
    expect(stalled.clock).toBe(5_116);
  });

  test("a restarted run keeps its clock, so a phase continues instead of jumping", () => {
    const resumed = stepFrame(null, 5_116, 90_000);
    expect(resumed).toEqual({ dt: 0, clock: 5_116 });
  });
});
