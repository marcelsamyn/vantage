import { createContext, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { motionRuns, stepFrame, subscribeMotion } from "./motion";

/**
 * False inside a screen that is mounted but not shown (screens with keepAlive).
 * `usePoll` pauses there, so a hidden City map stops fetching until you return to it.
 */
export const ScreenActiveContext = createContext(true);
export const useScreenActive = (): boolean => useContext(ScreenActiveContext);

/**
 * True inside background services (watchers). Their `usePoll`, `useNow` and `useInterval` keep running while the
 * browser tab is hidden, so alerts still arrive, but no more often than `HIDDEN_PERIOD_MS`.
 */
export const BackgroundContext = createContext(false);

/**
 * The shortest period of a background service's work while the tab is hidden. Alerts still arrive within a
 * minute, as browsers already throttle hidden tabs, and a hidden window sends next to no requests even in a
 * web view that does not throttle.
 */
export const HIDDEN_PERIOD_MS = 60_000;

export interface Polled<T> {
  data: T | undefined;
  error: Error | null;
  loading: boolean;
  updatedAt: number | null;
  refresh: () => void;
}

/**
 * Load data now and again every `intervalMs` (null = load once). Pauses while the browser tab is hidden
 * or the screen it belongs to is not shown (a background service slows to `HIDDEN_PERIOD_MS` instead),
 * keeps the last good data when a refresh fails, and aborts in-flight requests on change or unmount.
 * Pass `enabled: false` (via a null interval and `skip`) to hold off until inputs exist.
 */
export function usePoll<T>(load: (signal: AbortSignal) => Promise<T>, intervalMs: number | null, deps: readonly unknown[], skip = false): Polled<T> {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(!skip);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [nonce, setNonce] = useState(0);
  const loadRef = useRef(load);
  loadRef.current = load;
  const visible = useRunning();
  // The period is read when the next request is scheduled, not an effect dependency: a background poll changes
  // its period with every tab switch, and a restart would abort the request in flight and fetch again at once.
  const intervalRef = useRef(intervalMs);
  intervalRef.current = intervalMs;
  const periodic = intervalMs !== null;

  useEffect(() => {
    if (skip || !visible) return;
    let alive = true;
    let busy = false;
    let finishedAt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;

    const period = (): number | null => periodFor(intervalRef.current, document.visibilityState === "visible");
    const schedule = (delayMs: number): void => {
      clearTimeout(timer);
      timer = setTimeout(tick, delayMs);
    };

    const tick = async (): Promise<void> => {
      busy = true;
      controller = new AbortController();
      setLoading(true);
      try {
        const value = await loadRef.current(controller.signal);
        if (!alive) return;
        setData(value);
        setError(null);
        setUpdatedAt(Date.now());
      } catch (err) {
        if (!alive || (err instanceof DOMException && err.name === "AbortError")) return;
        setError(err instanceof Error ? err : new Error(String(err)));
      } finally {
        busy = false;
        finishedAt = Date.now();
        if (alive) setLoading(false);
      }
      const next = period();
      if (alive && next !== null) schedule(next);
    };
    // A tab switch changes the period of a background poll. Time the next request from the last one: coming
    // back after a long absence refreshes at once, switching back and forth sends nothing extra.
    const onVisibility = (): void => {
      const next = period();
      if (busy || next === null) return;
      schedule(Math.max(0, next - (Date.now() - finishedAt)));
    };
    document.addEventListener("visibilitychange", onVisibility);
    void tick();
    return () => {
      alive = false;
      clearTimeout(timer);
      controller?.abort();
      document.removeEventListener("visibilitychange", onVisibility);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, periodic, skip, visible, nonce]);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);
  return { data, error, loading, updatedAt, refresh };
}

function subscribeVisibility(cb: () => void): () => void {
  document.addEventListener("visibilitychange", cb);
  return () => document.removeEventListener("visibilitychange", cb);
}
export function useDocumentVisible(): boolean {
  return useSyncExternalStore(subscribeVisibility, () => document.visibilityState === "visible");
}

/**
 * True while this component's work can be seen: the tab is visible (or the component is a background service)
 * and its screen is shown. Clocks, intervals and polls stop otherwise.
 */
export function useRunning(): boolean {
  const documentVisible = useDocumentVisible();
  const screenActive = useScreenActive();
  const background = useContext(BackgroundContext);
  return (documentVisible || background) && screenActive;
}

/**
 * How often periodic work runs here: every `ms` while it can be seen, at most every `HIDDEN_PERIOD_MS` for a
 * background service in a hidden tab, and not at all otherwise (null).
 */
function usePeriod(ms: number | null): number | null {
  const documentVisible = useDocumentVisible();
  const running = useRunning();
  return running ? periodFor(ms, documentVisible) : null;
}

/** `ms` while the tab is visible, at least `HIDDEN_PERIOD_MS` while it is hidden (null: no periodic work). */
function periodFor(ms: number | null, documentVisible: boolean): number | null {
  if (ms === null) return null;
  return documentVisible ? ms : Math.max(ms, HIDDEN_PERIOD_MS);
}

/**
 * True while ambient loops (pulses, sweeps, glows) may run: the tab is visible, someone used it recently,
 * reduced motion is off, and this screen is shown. See `app/core/motion.ts`.
 */
export function useAmbientMotion(): boolean {
  const runs = useSyncExternalStore(subscribeMotion, motionRuns);
  return useScreenActive() && runs;
}

/**
 * Re-render every `ms` and return the current time. Stops while the tab is hidden or the screen is not shown.
 * With `ms` null it does not tick and each render reads the clock: for a clock that matters only sometimes.
 */
export function useNow(ms: number | null = 1000): number {
  const period = usePeriod(ms);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (period === null) return;
    // Catch up after a pause; on mount the value is fresh and React skips the render.
    setNow((prev) => (Date.now() - prev >= period ? Date.now() : prev));
    const id = setInterval(() => setNow(Date.now()), period);
    return () => clearInterval(id);
  }, [period]);
  // A value older than one period (no tick, or a tick that just started) would show a stale time: read the clock.
  return period === null || Date.now() - now > period ? Date.now() : now;
}

/**
 * The clock for motion between data updates, such as dead reckoning or positions in the sky. It re-renders
 * every `ms` while ambient motion runs and every `restMs` at rest. With a null period it does not tick, so
 * things move only when their data changes: pass `ms` null while nothing moves. It never ticks while the tab
 * is hidden. Each render reads the current time, so a data update places things where they are now.
 */
export function useMotionNow(ms: number | null, restMs: number | null = null): number {
  const documentVisible = useDocumentVisible();
  const screenActive = useScreenActive();
  const ambient = useAmbientMotion();
  const period = !documentVisible || !screenActive ? null : ambient ? ms : restMs;
  const [, setTick] = useState(0);
  useEffect(() => {
    if (period === null) return;
    const id = setInterval(() => setTick((n) => n + 1), period);
    return () => clearInterval(id);
  }, [period]);
  return Date.now();
}

/** Call `fn` every `ms` (null = never). Stops while the tab is hidden or the screen is not shown. */
export function useInterval(fn: () => void, ms: number | null): void {
  const ref = useRef(fn);
  ref.current = fn;
  const period = usePeriod(ms);
  useEffect(() => {
    if (period === null) return;
    const id = setInterval(() => ref.current(), period);
    return () => clearInterval(id);
  }, [period]);
}

/**
 * What drives an animation-frame loop:
 * - "ambient": decoration. Runs only while `useAmbientMotion()` is true, so it rests with the motion policy.
 * - "data": live data that changes every frame (audio, a camera). Runs while the tab is visible and the screen
 *   shown, whether or not anyone touches the page.
 */
export type FrameLoop = "ambient" | "data";

/**
 * Run `fn(dt, clock, now)` on every animation frame while `active` and the loop's driver allow it.
 * - `dt`: seconds since the previous frame, at most 0.1, and 0 on the first frame of a run.
 * - `clock`: the loop's own time in ms. It advances by `dt` only, so it skips every rest and stall. Use it for a
 *   phase (`clock % period`), which then continues where it stopped instead of jumping.
 * - `now`: the frame's timestamp on the `performance.now()` timeline. Use it to compare against stamps taken
 *   elsewhere (`performance.now()`, a track's `born`, a lock's `since`); `clock` cannot be compared with those.
 * While the loop is stopped but visible, each render draws one still frame (`dt` 0), so a canvas still shows new
 * data, hover and selection. `fps` caps the rate for motion that the eye reads as smooth at less than the
 * display's rate, such as a slow scroll or a map pulse.
 */
export function useAnimationFrame(fn: (dt: number, clock: number, now: number) => void, active = true, loop: FrameLoop = "ambient", fps?: number): void {
  const ref = useRef(fn);
  ref.current = fn;
  const clock = useRef<number | null>(null);
  const ambient = useAmbientMotion();
  const running = useRunning();
  const go = active && running && (loop === "data" || ambient);

  useEffect(() => {
    if (!go) return;
    // A little under the period, so a 30 fps cap on a 60 Hz display takes every second frame, not every third.
    const minGap = fps ? 1000 / fps - 4 : 0;
    let raf = 0;
    let last: number | null = null;
    const frame = (now: number): void => {
      if (last === null || now - last >= minGap) {
        const step = stepFrame(last, clock.current, now);
        last = now;
        clock.current = step.clock;
        ref.current(step.dt, step.clock, now);
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [go, fps]);

  const still = active && running && !go;
  useEffect(() => {
    if (!still) return;
    const raf = requestAnimationFrame((now) => {
      clock.current ??= now;
      ref.current(0, clock.current, now);
    });
    return () => cancelAnimationFrame(raf);
  });
}

/** Per-viewer convenience state. Storage can be unavailable (private mode), so every access is guarded. */
export function useStoredState<T>(key: string, initial: T): [T, (v: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => readStored(key, initial));
  const set = useCallback(
    (v: T | ((prev: T) => T)) => {
      setValue((prev) => {
        const next = typeof v === "function" ? (v as (p: T) => T)(prev) : v;
        writeStored(key, next);
        return next;
      });
    },
    [key],
  );
  return [value, set];
}

export function readStored<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(`vantage:${key}`);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export function writeStored(key: string, value: unknown): void {
  try {
    localStorage.setItem(`vantage:${key}`, JSON.stringify(value));
  } catch {
    /* storage full or blocked: the setting simply won't persist */
  }
}

/** Global keyboard shortcut. Ignored while typing in a field. */
export function useHotkey(match: (e: KeyboardEvent) => boolean, handler: (e: KeyboardEvent) => void, deps: readonly unknown[] = []): void {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement | null;
      const typing = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
      if (typing && !e.metaKey && !e.ctrlKey && e.key !== "Escape") return;
      if (match(e)) ref.current(e);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mq = matchMedia("(prefers-reduced-motion: reduce)");
      mq.addEventListener("change", cb);
      return () => mq.removeEventListener("change", cb);
    },
    () => matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
}
