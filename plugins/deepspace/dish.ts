/**
 * Line art of a Deep Space Network dish in real three-dimensional pose, drawn with a fixed camera.
 * World axes: x east, y north, z up. Azimuth runs clockwise from north; elevation is the angle above the horizon.
 */

type V3 = readonly [number, number, number];
type P2 = readonly [number, number];

const RAD = Math.PI / 180;
/** Scale of the drawing: pixels per metre of dish. A 70 m dish is about 154 px across. */
export const PX_PER_M = 2.2;
/** Radius of the compass ring on the ground, in pixels. */
export const GROUND_R = 100;

const YAW = 30 * RAD;
const PITCH = 22 * RAD;
const cosYaw = Math.cos(YAW);
const sinYaw = Math.sin(YAW);
const cosPitch = Math.cos(PITCH);
const sinPitch = Math.sin(PITCH);

export const VIEW = { width: 240, height: 240, groundX: 120, groundY: 192 } as const;

/** A 34 m dish never rises above the top of the lower part of the frame, so its frame drops the empty headroom the 70 m dish needs. */
export const viewBoxFor = (sizeM: number): string => (sizeM >= 60 ? `0 0 ${VIEW.width} ${VIEW.height}` : `0 46 ${VIEW.width} ${VIEW.height - 46}`);

const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: V3): V3 => {
  const n = Math.hypot(a[0], a[1], a[2]);
  return [a[0] / n, a[1] / n, a[2] / n];
};

/** Unit vector the dish looks along. */
export function pointing(azimuthDeg: number, elevationDeg: number): V3 {
  const az = azimuthDeg * RAD;
  const el = elevationDeg * RAD;
  return [Math.cos(el) * Math.sin(az), Math.cos(el) * Math.cos(az), Math.sin(el)];
}

/** Orthographic view from the south-west, a little above the ground. */
export function project(p: V3): P2 {
  const across = p[0] * cosYaw - p[1] * sinYaw;
  const away = p[0] * sinYaw + p[1] * cosYaw;
  return [VIEW.groundX + across, VIEW.groundY - (p[2] * cosPitch + away * sinPitch)];
}

const fix = (n: number): string => n.toFixed(1);
const line = (pts: readonly P2[]): string => pts.map(([x, y], i) => `${i ? "L" : "M"}${fix(x)} ${fix(y)}`).join("");
const closed = (pts: readonly P2[]): string => `${line(pts)}Z`;

export interface Tick {
  from: P2;
  to: P2;
  cardinal: boolean;
}

export interface DishDrawing {
  /** The compass ring on the ground, as an axis-aligned ellipse. */
  ring: { cx: number; cy: number; rx: number; ry: number };
  ticks: Tick[];
  north: P2;
  /** From the foot of the tower to the ring in the direction the dish faces. */
  azimuthLine: string;
  azimuthMark: P2;
  base: string;
  tower: string;
  yoke: string;
  rim: string;
  ribs: string;
  hoops: string;
  struts: string;
  feed: P2;
  /** The line of sight, from the feed outward. Down- and uplink beams run along it, offset to either side. */
  beams: { axis: [P2, P2]; down: [P2, P2]; up: [P2, P2] };
}

const RIM_STEPS = 56;
const BEAM_LENGTH = 170;
/** Depth of the bowl as a fraction of its radius. */
const DEPTH = 0.3;

export function drawDish(sizeM: number, azimuthDeg: number, elevationDeg: number): DishDrawing {
  const R = (sizeM / 2) * PX_PER_M;
  const d = pointing(azimuthDeg, elevationDeg);
  // Any vector not parallel to d gives a basis for the dish face; straight up is the natural choice until the dish looks at the zenith.
  const ref: V3 = Math.abs(d[2]) > 0.999 ? [1, 0, 0] : [0, 0, 1];
  const u = unit(cross(d, ref));
  const v = cross(d, u);
  const hubHeight = 1.2 * R;
  const hub: V3 = [0, 0, hubHeight];
  const depth = DEPTH * R;
  const focal = (R * R) / (4 * depth);

  /** A point on the bowl: s runs from the vertex (0) to the rim (1), t around the axis. */
  const bowl = (s: number, t: number): V3 => add(add(hub, mul(d, s * s * depth)), add(mul(u, R * s * Math.cos(t)), mul(v, R * s * Math.sin(t))));
  const hoop = (s: number, steps: number): P2[] => Array.from({ length: steps }, (_, i) => project(bowl(s, (i / steps) * Math.PI * 2)));

  const ribCount = sizeM >= 60 ? 12 : 8;
  const ribs = Array.from({ length: ribCount }, (_, k) => line(Array.from({ length: 7 }, (_, i) => project(bowl(i / 6, (k / ribCount) * Math.PI * 2)))));

  const feedPoint = add(hub, mul(d, focal));
  const feed = project(feedPoint);
  const struts = [0.25, 0.75, 1.25, 1.75].map((q) => line([project(bowl(1, q * Math.PI)), feed])).join("");

  const az = azimuthDeg * RAD;
  const trunnion: V3 = [Math.cos(az) * 0.32 * R, -Math.sin(az) * 0.32 * R, 0];
  const towerTop: V3 = [0, 0, hubHeight * 0.74];
  const yoke = [add(hub, trunnion), add(hub, mul(trunnion, -1))].map((t) => line([project(towerTop), project(t)])).join("");

  const baseR = 0.2 * R;
  const base = closed(Array.from({ length: 6 }, (_, i) => project([Math.cos((i / 6) * Math.PI * 2) * baseR, Math.sin((i / 6) * Math.PI * 2) * baseR, 0])));

  const ticks: Tick[] = Array.from({ length: 12 }, (_, k) => {
    const a = k * 30 * RAD;
    const cardinal = k % 3 === 0;
    const inner = GROUND_R;
    const outer = GROUND_R + (cardinal ? 9 : 5);
    return { from: project([Math.sin(a) * inner, Math.cos(a) * inner, 0]), to: project([Math.sin(a) * outer, Math.cos(a) * outer, 0]), cardinal };
  });

  const out = (offset: V3): [P2, P2] => [project(add(feedPoint, offset)), project(add(add(feedPoint, offset), mul(d, BEAM_LENGTH)))];
  const side = mul(u, 2.6);

  return {
    ring: { cx: VIEW.groundX, cy: VIEW.groundY, rx: GROUND_R, ry: GROUND_R * sinPitch },
    ticks,
    north: project([0, GROUND_R + 18, 0]),
    azimuthLine: line([project([0, 0, 0]), project([Math.sin(az) * GROUND_R, Math.cos(az) * GROUND_R, 0])]),
    azimuthMark: project([Math.sin(az) * GROUND_R, Math.cos(az) * GROUND_R, 0]),
    base,
    tower: line([project([0, 0, 0]), project([0, 0, hubHeight * 0.74])]),
    yoke,
    rim: closed(hoop(1, RIM_STEPS)),
    ribs: ribs.join(""),
    hoops: [0.5, 0.78].map((s) => closed(hoop(s, 36))).join(""),
    struts,
    feed,
    beams: { axis: out([0, 0, 0]), down: out(mul(side, -1)), up: out(side) },
  };
}

/** Move `from` toward `to` along the shorter way round the compass. */
export function easeAzimuth(from: number, to: number, k: number): number {
  const diff = ((((to - from) % 360) + 540) % 360) - 180;
  return (from + diff * k + 360) % 360;
}
