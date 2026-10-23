import type { Box } from "./types";

export interface Detection {
  cls: string;
  score: number;
  box: Box;
}

export interface Track {
  id: number;
  cls: string;
  score: number;
  /** Latest detected box, in source pixels. */
  box: Box;
  /** Box as drawn: eases toward `box` so the reticle glides instead of jumping. */
  shown: Box;
  born: number;
  lastSeen: number;
}

const MIN_IOU = 0.25;

export function iou(a: Box, b: Box): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  if (w <= 0 || h <= 0) return 0;
  const inter = w * h;
  return inter / (a.w * a.h + b.w * b.h - inter);
}

/**
 * Greedy IoU matching between frames. A track is a box that keeps its number while it stays in view.
 * It carries a class and a position and nothing else, so it can never tell two people apart across a gap.
 */
export function updateTracks(tracks: Track[], detections: Detection[], now: number, ttlMs: number, nextId: () => number): Track[] {
  const pairs: { t: number; d: number; score: number }[] = [];
  tracks.forEach((track, t) => {
    detections.forEach((det, d) => {
      if (det.cls !== track.cls) return;
      const score = iou(track.box, det.box);
      if (score >= MIN_IOU) pairs.push({ t, d, score });
    });
  });
  pairs.sort((a, b) => b.score - a.score);

  const usedTracks = new Set<number>();
  const usedDetections = new Set<number>();
  const next = tracks.map((track) => ({ ...track }));
  for (const { t, d } of pairs) {
    if (usedTracks.has(t) || usedDetections.has(d)) continue;
    usedTracks.add(t);
    usedDetections.add(d);
    const track = next[t];
    const det = detections[d];
    if (!track || !det) continue;
    track.box = det.box;
    track.score = det.score;
    track.lastSeen = now;
  }
  detections.forEach((det, d) => {
    if (usedDetections.has(d)) return;
    next.push({ id: nextId(), cls: det.cls, score: det.score, box: det.box, shown: { ...det.box }, born: now, lastSeen: now });
  });
  return next.filter((track) => now - track.lastSeen <= ttlMs);
}
