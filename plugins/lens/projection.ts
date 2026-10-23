import type { DeviceOrientation } from "../../app/core/heading";
import type { PlacedItem } from "../../app/core/nearby";
import { projectSight } from "../sky/extension";

export interface Frame {
  width: number;
  height: number;
  left: number;
  top: number;
}

/** Match object-fit: contain, so direction markers stay inside the camera picture. */
export function cameraFrame(width: number, height: number, videoWidth: number, videoHeight: number): Frame {
  if (width <= 0 || height <= 0 || videoWidth <= 0 || videoHeight <= 0) return { width: 0, height: 0, left: 0, top: 0 };
  const scale = Math.min(width / videoWidth, height / videoHeight);
  const w = videoWidth * scale, h = videoHeight * scale;
  return { width: w, height: h, left: (width - w) / 2, top: (height - h) / 2 };
}

export interface LensMarker {
  item: PlacedItem;
  x: number;
  y: number;
}

/** Ground-level bearings are approximate: sources do not locate an object's outline in the picture. */
export function lensMarkers(items: readonly PlacedItem[], pose: DeviceOrientation, frame: Frame, correctionDeg: number): LensMarker[] {
  if (frame.width < 144 || frame.height < 100) return [];
  const markers: LensMarker[] = [];
  for (const item of items) {
    if (item.bearing === null || !item.entity) continue;
    const at = projectSight(item.bearing + correctionDeg, 0, pose, frame.width, frame.height);
    if (!at) continue;
    const x = frame.left + Math.max(72, Math.min(frame.width - 72, at.x));
    const y = frame.top + Math.max(44, Math.min(frame.height - 44, at.y));
    // Keep touch targets and labels apart; every omitted marker remains in the nearby list.
    if (markers.some((m) => Math.abs(m.x - x) < 144 && Math.abs(m.y - y) < 88)) continue;
    markers.push({ item, x, y });
    if (markers.length === 6) break;
  }
  return markers;
}
