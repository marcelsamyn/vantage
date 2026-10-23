import { afterEach, beforeEach, expect, jest, test } from "bun:test";
import { onCameraRest, type MoveEvents } from "./layer-kit";

type Listener = (e: { originalEvent?: unknown }) => void;

/** The two camera events, fired by hand. */
function camera(): MoveEvents & { fire: (type: "movestart" | "moveend", e?: { originalEvent?: unknown }) => void } {
  const listeners = new Map<string, Set<Listener>>();
  return {
    on: (type, listener) => listeners.set(type, (listeners.get(type) ?? new Set()).add(listener)),
    off: (type, listener) => listeners.get(type)?.delete(listener),
    fire: (type, e = {}) => {
      for (const listener of listeners.get(type) ?? []) listener(e);
    },
  };
}

const GESTURE = { originalEvent: {} };

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

test("reports once the camera has rested for a quarter second", () => {
  const map = camera();
  let reports = 0;
  onCameraRest(map, () => reports++);
  map.fire("movestart", GESTURE);
  map.fire("moveend");
  jest.advanceTimersByTime(249);
  expect(reports).toBe(0);
  jest.advanceTimersByTime(1);
  expect(reports).toBe(1);
  jest.advanceTimersByTime(5000);
  expect(reports).toBe(1);
});

test("a drag that cuts a fling short holds the report until it ends", () => {
  const map = camera();
  let reports = 0;
  onCameraRest(map, () => reports++);
  // The fling ends because a new drag grabs the map.
  map.fire("moveend");
  map.fire("movestart", GESTURE);
  jest.advanceTimersByTime(3000);
  expect(reports).toBe(0);
  map.fire("moveend");
  jest.advanceTimersByTime(250);
  expect(reports).toBe(1);
});

test("a camera that follows you and never rests reports each move within a second of its end", () => {
  const map = camera();
  let now = 0;
  const reports: number[] = [];
  onCameraRest(map, () => reports.push(now));
  const advance = (ms: number): void => {
    for (let i = 0; i < ms; i++) {
      now++;
      jest.advanceTimersByTime(1);
    }
  };
  // A new fix every 900 ms: each step ends one move and starts the next before a quarter second of rest.
  const ends: number[] = [];
  for (let i = 0; i < 10; i++) {
    map.fire("moveend");
    ends.push(now);
    advance(100);
    map.fire("movestart");
    advance(800);
  }
  advance(1000);
  for (const end of ends) expect((reports.find((at) => at > end) ?? Infinity) - end).toBeLessThanOrEqual(1000);
  expect(reports.length).toBeLessThan(ends.length);
});

test("stops reporting once unsubscribed", () => {
  const map = camera();
  let reports = 0;
  const stop = onCameraRest(map, () => reports++);
  map.fire("moveend");
  stop();
  jest.advanceTimersByTime(5000);
  map.fire("moveend");
  jest.advanceTimersByTime(5000);
  expect(reports).toBe(0);
});
