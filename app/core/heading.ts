import { useEffect } from "react";
import { create } from "zustand";
import { readStored, useRunning, writeStored } from "./hooks";

/**
 * Which way you face, from the device's compass, for views that turn a map with you or draw your heading.
 *
 * - iOS reports `webkitCompassHeading` on `deviceorientation`, after `requestCompass()` asked for permission inside
 *   a tap. Other browsers report `deviceorientationabsolute`.
 * - Readings are smoothed on the circle (so 359° and 1° average to 0°, not 180°) and published at most 15 times a
 *   second, and only when the heading moved by a degree or more: a phone lying still costs no renders.
 * - Nothing listens while no view asks with `useHeading(true)`, while the page is hidden, or while the view's screen
 *   is not shown.
 */

/**
 * - "unsupported": no compass here, such as on a desktop.
 * - "ask": the browser asks for permission first (iOS); call `requestCompass()` from a tap.
 * - "denied": permission was refused.
 * - "ready": readings flow while a view listens.
 * - "absent": the browser offered the event, but no reading came: the device has no compass.
 */
export type CompassState = "unsupported" | "ask" | "denied" | "ready" | "absent";

interface CompassStore {
  state: CompassState;
  enabled: boolean;
  setEnabled: (enabled: boolean) => void;
  /** Degrees clockwise from north, smoothed; null until a reading arrives or while nobody listens. */
  heading: number | null;
  orientation: DeviceOrientation | null;
}

/** How long the smoothing remembers, in ms: long enough to calm a shaky hand, short enough to follow a turn. */
const SMOOTH_MS = 160;
/** At most this many published headings per second. */
const MAX_RATE_HZ = 15;
/** Smaller changes are not published. */
const MIN_STEP_DEG = 1;
/** A device that has sent no reading by then has no compass. */
const ABSENT_AFTER_MS = 3000;

type PermissionAsk = () => Promise<"granted" | "denied">;
/** iOS 13 and later add a static `requestPermission` that the DOM types do not know. */
const permissionAsk = (): PermissionAsk | null => {
  if (typeof DeviceOrientationEvent === "undefined") return null;
  const ask: unknown = Reflect.get(DeviceOrientationEvent, "requestPermission");
  return typeof ask === "function" ? (ask.bind(DeviceOrientationEvent) as PermissionAsk) : null;
};

function initialState(): CompassState {
  if (typeof window === "undefined" || typeof DeviceOrientationEvent === "undefined") return "unsupported";
  // Desktop browsers offer the event without a sensor behind it; a compass comes with a touch screen.
  if (!matchMedia("(any-pointer: coarse)").matches) return "unsupported";
  if (permissionAsk()) return "ask";
  return "ondeviceorientationabsolute" in window ? "ready" : "unsupported";
}

export const useCompass = create<CompassStore>((set) => ({
  state: initialState(),
  // Keep the map's existing saved choice as the shared orientation preference.
  enabled: readStored<unknown>("city:heading", "north") === "facing",
  setEnabled: (enabled) => {
    writeStored("city:heading", enabled ? "facing" : "north");
    set({ enabled });
  },
  heading: null,
  orientation: null,
}));

export function noCompassReason(state: CompassState): string | null {
  switch (state) {
    case "unsupported": return "This device has no compass. Use a phone with motion and orientation access.";
    case "absent": return "No compass reading arrived. Check motion and orientation access, then reload the page.";
    case "denied": return "Motion and orientation access was denied. Allow it in your browser settings, then reload the page.";
    case "ask":
    case "ready": return null;
  }
}

/**
 * Ask for the compass. Call it from a tap or a click: iOS refuses to ask otherwise. Resolves to the new state;
 * other browsers need no permission and answer at once.
 */
export async function requestCompass(): Promise<CompassState> {
  const { state } = useCompass.getState();
  const ask = permissionAsk();
  if (state !== "ask" || !ask) return state;
  const next: CompassState = (await ask()) === "granted" ? "ready" : "denied";
  useCompass.setState({ state: next });
  return next;
}

// ── Pure parts ────────────────────────────────────────────────────

export const normDeg = (deg: number): number => ((deg % 360) + 360) % 360;

/** The signed shortest turn from `from` to `to`, in degrees from -180 to 180. */
export const turnDeg = (from: number, to: number): number => {
  const d = normDeg(to - from);
  return d > 180 ? d - 360 : d;
};

export interface OrientationReading {
  webkitCompassHeading?: number | null;
  alpha: number | null;
  absolute: boolean;
  beta?: number | null;
  gamma?: number | null;
}

/** The device's north-relative yaw; null when the event carries no compass reference. */
function northYawOf(e: OrientationReading): number | null {
  if (typeof e.webkitCompassHeading === "number" && Number.isFinite(e.webkitCompassHeading) && e.webkitCompassHeading >= 0) return normDeg(e.webkitCompassHeading);
  // `alpha` turns counter-clockwise from north; with the phone held up or lying flat, 360 - alpha is where its top points.
  if (e.absolute && e.alpha !== null && Number.isFinite(e.alpha)) return normDeg(360 - e.alpha);
  return null;
}

/** Heading through the phone's back, or along the displayed top edge when held flat face-up. */
export function headingOf(e: OrientationReading, screenAngle: number): number | null {
  const yaw = northYawOf(e);
  if (yaw === null) return null;
  const pose = orientationOf(e, screenAngle);
  if (!pose) return normDeg(yaw + screenAngle);
  // Only a mostly face-up phone uses its top edge. Looking higher must not reverse the heading.
  const direction = pose.forward[2] < -Math.SQRT1_2 ? pose.up : pose.forward;
  // At the zenith the sight has no horizontal direction; keep the compass reference.
  if (Math.hypot(direction[0], direction[1]) < 1e-6) return normDeg(yaw + screenAngle);
  return normDeg(Math.atan2(direction[0], direction[1]) * 180 / Math.PI);
}

/** Screen axes in east/north/up coordinates. Forward points through the back of the phone. */
export type OrientationVector = readonly [number, number, number];
export interface DeviceOrientation {
  right: OrientationVector;
  up: OrientationVector;
  forward: OrientationVector;
}

/** Z-X-Y device rotations, with the screen's portrait/landscape rotation applied to its axes. */
export function orientationOf(e: OrientationReading, screenAngle: number): DeviceOrientation | null {
  const heading = northYawOf(e);
  if (heading === null || typeof e.beta !== "number" || typeof e.gamma !== "number" || !Number.isFinite(e.beta) || !Number.isFinite(e.gamma)) return null;
  const a = -heading * Math.PI / 180;
  const b = e.beta * Math.PI / 180;
  const g = e.gamma * Math.PI / 180;
  const ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b), cg = Math.cos(g), sg = Math.sin(g);
  const right: OrientationVector = [ca * cg - sa * sb * sg, sa * cg + ca * sb * sg, -cb * sg];
  const up: OrientationVector = [-sa * cb, ca * cb, sb];
  const forward: OrientationVector = [-ca * sg - sa * sb * cg, -sa * sg + ca * sb * cg, -cb * cg];
  const s = -screenAngle * Math.PI / 180;
  const rotate = (x: OrientationVector, y: OrientationVector): OrientationVector => [x[0] * Math.cos(s) + y[0] * Math.sin(s), x[1] * Math.cos(s) + y[1] * Math.sin(s), x[2] * Math.cos(s) + y[2] * Math.sin(s)];
  return { right: rotate(right, up), up: rotate(up, [-right[0], -right[1], -right[2]]), forward };
}

/** A low-pass filter on the unit circle: the heading's sine and cosine are averaged, not its degrees. */
export interface HeadingFilter {
  x: number;
  y: number;
  /** The time of the last reading, in ms. */
  t: number;
}

/** Fold one reading at time `t` (ms) into the filter. Readings far apart in time count fully. */
export function smoothHeading(prev: HeadingFilter | null, deg: number, t: number, memoryMs = SMOOTH_MS): HeadingFilter {
  const rad = (deg * Math.PI) / 180;
  const x = Math.sin(rad);
  const y = Math.cos(rad);
  if (!prev) return { x, y, t };
  const k = 1 - Math.exp(-Math.max(0, t - prev.t) / memoryMs);
  return { x: prev.x + k * (x - prev.x), y: prev.y + k * (y - prev.y), t };
}

export const filteredHeading = (f: HeadingFilter): number => normDeg((Math.atan2(f.x, f.y) * 180) / Math.PI);

/**
 * An angle that keeps turning past 360° instead of jumping back, so a CSS transition from 359° to 1° turns 2°, not
 * 358° the long way round. `prev` is the last unwrapped angle.
 */
export const unwrapDeg = (prev: number | null, next: number): number => (prev === null ? normDeg(next) : prev + turnDeg(prev, next));

// ── Listening ─────────────────────────────────────────────────────

let users = 0;
let stopListening: (() => void) | null = null;

function listen(): () => void {
  const eventName = "ondeviceorientationabsolute" in window && !permissionAsk() ? "deviceorientationabsolute" : "deviceorientation";
  let filter: HeadingFilter | null = null;
  let orientation: DeviceOrientation | null = null;
  let published = 0;
  let trailing: ReturnType<typeof setTimeout> | undefined;
  const gap = 1000 / MAX_RATE_HZ;

  const publish = (): void => {
    trailing = undefined;
    if (!filter) return;
    const next = filteredHeading(filter);
    const prev = useCompass.getState();
    const currentPose = orientation;
    const previousPose = prev.orientation;
    const changed = currentPose !== null && (previousPose === null || (["right", "up", "forward"] as const).some((axis) => ([0, 1, 2] as const).some((i) => Math.abs(currentPose[axis][i] - previousPose[axis][i]) > 0.01)));
    if (prev.heading !== null && Math.abs(turnDeg(prev.heading, next)) < MIN_STEP_DEG && !changed && Boolean(orientation) === Boolean(prev.orientation)) return;
    published = performance.now();
    useCompass.setState({ heading: next, orientation });
  };

  const onReading = (e: Event): void => {
    if (!(e instanceof DeviceOrientationEvent)) return;
    // A browser without the sensor says so with one event that carries no angles.
    if (e.alpha === null && e.beta === null && e.gamma === null) {
      useCompass.setState({ state: "absent", heading: null, orientation: null });
      return;
    }
    const compassHeading: unknown = Reflect.get(e, "webkitCompassHeading");
    const reading: OrientationReading = { alpha: e.alpha, beta: e.beta, gamma: e.gamma, absolute: e.absolute, webkitCompassHeading: typeof compassHeading === "number" ? compassHeading : null };
    const screenAngle = screen.orientation?.angle ?? 0;
    const deg = headingOf(reading, screenAngle);
    if (deg === null) return;
    clearTimeout(absent);
    filter = smoothHeading(filter, deg, e.timeStamp);
    orientation = orientationOf(reading, screenAngle);
    // The last reading of a turn is published once the rate allows, so the map never stops short of it.
    const wait = published + gap - performance.now();
    if (wait <= 0) publish();
    else trailing ??= setTimeout(publish, wait);
  };

  const absent = setTimeout(() => useCompass.setState({ state: "absent", heading: null, orientation: null }), ABSENT_AFTER_MS);
  window.addEventListener(eventName, onReading);
  return () => {
    clearTimeout(absent);
    clearTimeout(trailing);
    window.removeEventListener(eventName, onReading);
    useCompass.setState({ heading: null, orientation: null });
  };
}

/**
 * Your heading while `active`, in degrees clockwise from north; null while unknown. Every view that calls it with
 * `active` shares one listener, which stops when the last one stops, the page is hidden or the screen not shown.
 */
function useCompassListening(active: boolean): boolean {
  const running = useRunning();
  const state = useCompass((s) => s.state);
  const enabled = useCompass((s) => s.enabled);
  const on = active && enabled && running && state === "ready";
  useEffect(() => {
    if (!on) return;
    users += 1;
    stopListening ??= listen();
    return () => {
      users -= 1;
      if (users > 0) return;
      stopListening?.();
      stopListening = null;
    };
  }, [on]);
  return on;
}

export function useHeading(active: boolean): number | null {
  const on = useCompassListening(active);
  const heading = useCompass((s) => s.heading);
  return on ? heading : null;
}

export function useOrientation(active: boolean): DeviceOrientation | null {
  const on = useCompassListening(active);
  const orientation = useCompass((s) => s.orientation);
  return on ? orientation : null;
}
