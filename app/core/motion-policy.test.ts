import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { IDLE_MS } from "./motion";

type Handler = (event?: unknown) => void;

/** A page with a manual clock and timers, so the policy's idle logic runs without a browser. */
function fakePage() {
  let now = 1_000;
  let nextTimer = 1;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const windowHandlers = new Map<string, Handler[]>();
  const documentHandlers = new Map<string, Handler[]>();
  const reducedHandlers: Handler[] = [];
  const page = {
    visibilityState: "visible" as "visible" | "hidden",
    reduced: { matches: false },
    root: { dataset: {} as Record<string, string> },
    active: { tagName: "BODY" },
  };
  const add = (map: Map<string, Handler[]>) => (type: string, fn: Handler) => map.set(type, [...(map.get(type) ?? []), fn]);

  Object.assign(globalThis, {
    window: { addEventListener: add(windowHandlers) },
    document: {
      get visibilityState() {
        return page.visibilityState;
      },
      get activeElement() {
        return page.active;
      },
      addEventListener: add(documentHandlers),
      documentElement: page.root,
    },
    matchMedia: () => ({
      get matches() {
        return page.reduced.matches;
      },
      addEventListener: (_: string, fn: Handler) => reducedHandlers.push(fn),
    }),
    setTimeout: (fn: () => void, ms: number) => {
      const id = nextTimer++;
      timers.set(id, { at: now + ms, fn });
      return id;
    },
    clearTimeout: (id: number) => timers.delete(id),
  });
  globalThis.performance = { now: () => now } as Performance;

  return {
    page,
    pendingTimers: () => timers.size,
    advance(ms: number): void {
      const end = now + ms;
      for (;;) {
        const due = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]);
        now = due[1].at;
        due[1].fn();
      }
      now = end;
    },
    focusFrame(): void {
      page.active = { tagName: "IFRAME" };
      windowHandlers.get("blur")?.forEach((fn) => fn());
    },
    focusBlurOnly: (): void => windowHandlers.get("blur")?.forEach((fn) => fn()),
    leaveFrame(): void {
      page.active = { tagName: "BODY" };
    },
    input: (): void => windowHandlers.get("pointermove")?.forEach((fn) => fn()),
    setVisible(visible: boolean): void {
      page.visibilityState = visible ? "visible" : "hidden";
      documentHandlers.get("visibilitychange")?.forEach((fn) => fn());
    },
    setReduced(reduced: boolean): void {
      page.reduced.matches = reduced;
      reducedHandlers.forEach((fn) => fn());
    },
    listeners: () => [...windowHandlers.values()].flat().length + [...documentHandlers.values()].flat().length + reducedHandlers.length,
  };
}

const saved = { ...globalThis } as Record<string, unknown>;
let env: ReturnType<typeof fakePage>;
let motion: typeof import("./motion");

beforeEach(async () => {
  env = fakePage();
  // A fresh module instance per test: the policy keeps its state at module level.
  motion = await import(`./motion?policy=${Math.random()}`);
});

afterEach(() => {
  for (const key of ["window", "document", "matchMedia", "setTimeout", "clearTimeout", "performance"]) (globalThis as Record<string, unknown>)[key] = saved[key];
});

describe("startMotionPolicy", () => {
  test("rests after the idle period and runs again on input", () => {
    motion.startMotionPolicy();
    expect(motion.motionRuns()).toBe(true);
    env.advance(IDLE_MS + 1);
    expect(motion.motionRuns()).toBe(false);
    expect(env.page.root.dataset.motion).toBe("rest");
    env.input();
    expect(motion.motionRuns()).toBe(true);
    expect(env.page.root.dataset.motion).toBe("run");
  });

  test("input in the middle of a period moves the end of the period", () => {
    motion.startMotionPolicy();
    env.advance(IDLE_MS / 2);
    env.input();
    env.advance(IDLE_MS / 2 + 1);
    expect(motion.motionRuns()).toBe(true);
    env.advance(IDLE_MS / 2);
    expect(motion.motionRuns()).toBe(false);
  });

  test("showing the page again counts as input", () => {
    motion.startMotionPolicy();
    env.advance(IDLE_MS - 1_000);
    env.setVisible(false);
    expect(motion.motionRuns()).toBe(false);
    env.advance(10 * IDLE_MS);
    env.setVisible(true);
    expect(motion.motionRuns()).toBe(true);
    env.advance(IDLE_MS - 1);
    expect(motion.motionRuns()).toBe(true);
    env.advance(2);
    expect(motion.motionRuns()).toBe(false);
  });

  test("a change of the reduced-motion setting is picked up, and input does not override it", () => {
    motion.startMotionPolicy();
    env.setReduced(true);
    expect(motion.motionRuns()).toBe(false);
    env.input();
    expect(motion.motionRuns()).toBe(false);
    env.setReduced(false);
    expect(motion.motionRuns()).toBe(true);
  });

  test("tells subscribers only when the state changes", () => {
    motion.startMotionPolicy();
    let calls = 0;
    motion.subscribeMotion(() => calls++);
    env.input();
    env.advance(1_000);
    expect(calls).toBe(0);
    env.advance(IDLE_MS);
    expect(calls).toBe(1);
  });

  test("focus inside a frame keeps the page running until focus leaves", () => {
    motion.startMotionPolicy();
    env.advance(IDLE_MS - 1_000);
    env.focusFrame();
    env.advance(5 * IDLE_MS);
    expect(motion.motionRuns()).toBe(true);
    env.leaveFrame();
    env.advance(IDLE_MS + 1);
    expect(motion.motionRuns()).toBe(false);
  });

  test("focusing a frame wakes a resting page", () => {
    motion.startMotionPolicy();
    env.advance(IDLE_MS + 1);
    expect(motion.motionRuns()).toBe(false);
    env.leaveFrame();
    env.focusFrame();
    expect(motion.motionRuns()).toBe(true);
    env.leaveFrame();
    env.advance(IDLE_MS + 1);
    expect(motion.motionRuns()).toBe(false);
  });

  test("a window blur that lands outside a frame is not use", () => {
    motion.startMotionPolicy();
    env.advance(IDLE_MS + 1);
    env.page.active = { tagName: "BODY" };
    env.focusBlurOnly();
    expect(motion.motionRuns()).toBe(false);
  });

  test("a second start adds no listeners and no timers", () => {
    motion.startMotionPolicy();
    const listeners = env.listeners();
    const timers = env.pendingTimers();
    motion.startMotionPolicy();
    expect(env.listeners()).toBe(listeners);
    expect(env.pendingTimers()).toBe(timers);
  });
});
