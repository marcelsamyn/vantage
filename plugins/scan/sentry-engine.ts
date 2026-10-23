import { useEffect } from "react";
import { feed } from "../../app/core/feed";
import { fmt } from "../../app/core/format";
import { readInk } from "./hud";
import { thresholds, useSentry } from "./store";
import type { Box, Frame, GetFrame, MotionEvent } from "./types";

const SAMPLE_MS = 100;
const GRID_WIDTH = 96;
const THUMB_WIDTH = 192;
/** Samples in a row above the limit before it counts as motion. One noisy frame is not an event. */
const SUSTAIN = 2;
const COOLDOWN_MS = 4000;
const SETTLE_MS = 1200;

function gray(data: Uint8ClampedArray, out: Uint8Array): void {
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    out[p] = (data[i] ?? 0) * 0.299 + (data[i + 1] ?? 0) * 0.587 + (data[i + 2] ?? 0) * 0.114;
  }
}

function thumbnail(frame: Frame, motion: Box | null): string {
  const canvas = document.createElement("canvas");
  canvas.width = THUMB_WIDTH;
  canvas.height = Math.round((THUMB_WIDTH * frame.height) / frame.width);
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  ctx.drawImage(frame.el, 0, 0, canvas.width, canvas.height);
  if (motion) {
    ctx.strokeStyle = readInk().alarm;
    ctx.lineWidth = 2;
    ctx.strokeRect(motion.x * canvas.width, motion.y * canvas.height, motion.w * canvas.width, motion.h * canvas.height);
  }
  return canvas.toDataURL("image/jpeg", 0.7);
}

/**
 * Motion detection by frame differencing on a small grayscale copy of the picture.
 * Runs headless while the sentry is armed, whichever mode is showing.
 */
export function useSentryEngine(getFrame: GetFrame, sourceLabel: string): void {
  const armed = useSentry((s) => s.armed);

  useEffect(() => {
    if (!armed) return;
    const grid = document.createElement("canvas");
    const gctx = grid.getContext("2d", { willReadFrequently: true });
    if (!gctx) return;

    let previous: Uint8Array | null = null;
    let frameKey = "";
    let streak = 0;
    let lastEventAt = 0;
    const armedAt = performance.now();

    const tick = (): void => {
      const frame = getFrame();
      if (!frame || frame.kind === "image") return;
      const state = useSentry.getState();
      const gw = GRID_WIDTH;
      const gh = Math.max(8, Math.round((GRID_WIDTH * frame.height) / frame.width));
      if (grid.width !== gw || grid.height !== gh || frameKey !== frame.key) {
        grid.width = gw;
        grid.height = gh;
        previous = null;
        frameKey = frame.key;
      }
      gctx.drawImage(frame.el, 0, 0, gw, gh);
      const current = new Uint8Array(gw * gh);
      gray(gctx.getImageData(0, 0, gw, gh).data, current);
      if (!previous) {
        previous = current;
        return;
      }

      const zone = state.zone;
      const x0 = zone ? Math.floor(zone.x * gw) : 0;
      const y0 = zone ? Math.floor(zone.y * gh) : 0;
      const x1 = zone ? Math.min(gw, Math.ceil((zone.x + zone.w) * gw)) : gw;
      const y1 = zone ? Math.min(gh, Math.ceil((zone.y + zone.h) * gh)) : gh;
      const limits = thresholds(state.sensitivity);
      let changed = 0;
      let minX = gw;
      let minY = gh;
      let maxX = -1;
      let maxY = -1;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = y * gw + x;
          if (Math.abs((current[i] ?? 0) - (previous[i] ?? 0)) <= limits.pixel) continue;
          changed++;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
      previous = current;
      const area = Math.max(1, (x1 - x0) * (y1 - y0));
      const percent = (changed / area) * 100;
      state.sample(percent);

      streak = percent >= limits.area ? streak + 1 : 0;
      const now = performance.now();
      if (streak < SUSTAIN || now - armedAt < SETTLE_MS || now - lastEventAt < COOLDOWN_MS) return;
      lastEventAt = now;
      streak = 0;

      const box: Box | null = maxX < 0 ? null : { x: minX / gw, y: minY / gh, w: (maxX - minX + 1) / gw, h: (maxY - minY + 1) / gh };
      const event: MotionEvent = { id: `m${Date.now()}`, at: Date.now(), amount: percent, thumb: thumbnail(frame, box), source: sourceLabel };
      useSentry.getState().record(event);
      feed(
        {
          level: "alert",
          source: "scan",
          title: "Motion detected",
          detail: `${fmt.one(percent)}% of the ${zone ? "watched zone" : "frame"} changed · ${sourceLabel}`,
          go: { screen: "scan", action: "sentry" },
        },
        { key: "scan.motion", dedupeMs: 30_000, toast: true },
      );
    };

    const id = setInterval(tick, SAMPLE_MS);
    return () => clearInterval(id);
  }, [armed, getFrame, sourceLabel]);
}
