import type { DeviceOrientation, OrientationVector } from "../../app/core/heading";

const dot = (a: OrientationVector, b: OrientationVector): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** A 60° vertical field of view through the back of the phone, including its screen rotation. */
export function projectSight(az: number, el: number, pose: DeviceOrientation, width: number, height: number): { x: number; y: number } | null {
  const a = az * Math.PI / 180, e = el * Math.PI / 180;
  const target: OrientationVector = [Math.sin(a) * Math.cos(e), Math.cos(a) * Math.cos(e), Math.sin(e)];
  const depth = dot(target, pose.forward);
  if (depth <= 0.001) return null;
  const focal = height / (2 * Math.tan(Math.PI / 6));
  const x = width / 2 + focal * dot(target, pose.right) / depth;
  const y = height / 2 - focal * dot(target, pose.up) / depth;
  return x >= 0 && x <= width && y >= 0 && y <= height ? { x, y } : null;
}
