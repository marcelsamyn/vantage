/**
 * The motion policy for ambient loops: motion that carries no information, such as pulses, sweeps, scan bars
 * and glows. They run only while the page is visible, someone used it in the last `IDLE_MS`, and the system
 * does not ask for reduced motion. A window that nobody touches then costs close to nothing.
 *
 * - CSS loops put `var(--v-loop)` in their `animation` shorthand. At rest the root gets `data-motion="rest"`,
 *   the variable turns to `paused`, and each loop holds its phase, so it resumes on the next input without a jump.
 * - JS loops ask through `useAmbientMotion()`, `useAnimationFrame()` or `useMotionNow()` in `hooks.ts`.
 *
 * Motion that shows a change in data (a value that updates, a vehicle that moves, a new event) still plays once
 * when the data changes.
 */

/** Time without pointer, key, wheel or touch input (or focus inside a frame) after which ambient loops rest. */
export const IDLE_MS = 2 * 60_000;

export type Motion = "run" | "rest";

export interface MotionInput {
  visible: boolean;
  reducedMotion: boolean;
  /** `performance.now()` of the last input, or of the moment the page became visible. */
  lastInput: number;
}

/** Whether ambient loops may run at `now`, and in how many ms that changes if no input arrives (null: not by itself). */
export function decideMotion(input: MotionInput, now: number, idleMs = IDLE_MS): { motion: Motion; recheckInMs: number | null } {
  if (!input.visible || input.reducedMotion) return { motion: "rest", recheckInMs: null };
  const left = input.lastInput + idleMs - now;
  return left > 0 ? { motion: "run", recheckInMs: left } : { motion: "rest", recheckInMs: null };
}

/** The longest frame step a loop reports, so a stall (a busy tab, a slow frame) never throws a phase or an integration forward. */
export const MAX_FRAME_S = 0.1;

export interface FrameStep {
  /** Seconds since the previous frame, at most `MAX_FRAME_S`; 0 on the first frame of a run. */
  dt: number;
  /** The loop's own clock in ms: it advances by `dt` only, so it never counts a rest or a stall. */
  clock: number;
}

/** Advance a loop by one frame. `last` is the timestamp of the previous frame (null at the start of a run), `now` the rAF timestamp. */
export function stepFrame(last: number | null, clock: number | null, now: number): FrameStep {
  const dt = last === null ? 0 : Math.min(MAX_FRAME_S, (now - last) / 1000);
  return { dt, clock: (clock ?? now) + dt * 1000 };
}

const INPUT_EVENTS = ["pointerdown", "pointermove", "keydown", "wheel", "touchstart"] as const;

let input: MotionInput | null = null;
let motion: Motion = "run";
let timer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();

/** A frame (webcam player, YouTube embed, KiwiSDR) takes its input itself, so the page never sees it. */
const iframeHasFocus = (): boolean => document.activeElement?.tagName === "IFRAME";

function update(): void {
  if (!input) return;
  // Focus inside a frame is use: the timer that ends the idle period finds it still there and keeps the page running.
  if (iframeHasFocus()) input.lastInput = performance.now();
  const next = decideMotion(input, performance.now());
  clearTimeout(timer);
  timer = next.recheckInMs === null ? undefined : setTimeout(update, next.recheckInMs);
  if (next.motion === motion) return;
  motion = next.motion;
  document.documentElement.dataset.motion = motion;
  for (const listener of listeners) listener();
}

/** Start the policy once, at boot. Input listeners are passive and only record a time; one timer checks for idleness and for focus inside a frame. */
export function startMotionPolicy(): void {
  if (input) return;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  input = { visible: document.visibilityState === "visible", reducedMotion: reduced.matches, lastInput: performance.now() };
  const onInput = (): void => {
    if (!input) return;
    input.lastInput = performance.now();
    // While running, the pending timer re-reads lastInput when it fires, so most events cost one assignment.
    if (motion === "rest") update();
  };
  for (const type of INPUT_EVENTS) window.addEventListener(type, onInput, { capture: true, passive: true });
  // The window loses focus when a click or Tab moves it into a frame.
  window.addEventListener("blur", () => iframeHasFocus() && onInput());
  document.addEventListener("visibilitychange", () => {
    if (!input) return;
    input.visible = document.visibilityState === "visible";
    // Coming back to the page counts as use.
    if (input.visible) input.lastInput = performance.now();
    update();
  });
  reduced.addEventListener("change", () => {
    if (!input) return;
    input.reducedMotion = reduced.matches;
    update();
  });
  document.documentElement.dataset.motion = motion;
  update();
}

export function subscribeMotion(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** True while ambient loops may run. Before the policy starts (tests, scripts), motion is allowed. */
export const motionRuns = (): boolean => motion === "run";
