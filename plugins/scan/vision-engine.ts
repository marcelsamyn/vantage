import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { groupOf } from "./profiles";
import { updateTracks, type Detection, type Track } from "./tracker";
import type { GetFrame } from "./types";

type Model = import("@tensorflow-models/coco-ssd").ObjectDetection;

let modelPromise: Promise<Model> | null = null;

/** Both libraries are large, so they load on first use only. The ~2 MB model weights come from Google's servers. */
function loadModel(): Promise<Model> {
  modelPromise ??= (async () => {
    const [tf, coco] = await Promise.all([import("@tensorflow/tfjs"), import("@tensorflow-models/coco-ssd")]);
    await tf.ready();
    return coco.load({ base: "lite_mobilenet_v2" });
  })().catch((err: unknown) => {
    modelPromise = null;
    throw err;
  });
  return modelPromise;
}

export type ModelStatus = "idle" | "loading" | "ready" | "error";

export interface VisionStats {
  people: number;
  vehicles: number;
  objects: number;
  /** Detections per second for camera and video. Zero for a still image. */
  fps: number;
}

export interface Vision {
  status: ModelStatus;
  error: string | null;
  retry: () => void;
  /** Mutable list the HUD reads every animation frame. */
  tracksRef: RefObject<Track[]>;
  stats: VisionStats;
}

const MIN_SCORE = 0.5;
const MAX_BOXES = 20;
/** A moving camera loses boxes quickly. A still image keeps them for as long as it is on screen. */
const LIVE_TTL_MS = 1500;
const COUNT_WINDOW_MS = 900;
const NO_STATS: VisionStats = { people: 0, vehicles: 0, objects: 0, fps: 0 };
const nextFrame = (): Promise<number> => new Promise((resolve) => requestAnimationFrame(resolve));

export function useVision(getFrame: GetFrame, active: boolean): Vision {
  const [status, setStatus] = useState<ModelStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [stats, setStats] = useState<VisionStats>(NO_STATS);
  const tracksRef = useRef<Track[]>([]);

  // Counts describe what is in view right now, so they clear when there is no picture or the mode changes.
  useEffect(() => {
    if (active) return;
    tracksRef.current = [];
    setStats(NO_STATS);
  }, [active]);

  useEffect(() => {
    if (!active) return;
    let alive = true;
    setStatus("loading");
    setError(null);
    loadModel().then(
      () => alive && setStatus("ready"),
      (err: unknown) => {
        if (!alive) return;
        setStatus("error");
        setError(err instanceof Error ? err.message : String(err));
      },
    );
    return () => {
      alive = false;
    };
  }, [active, attempt]);

  useEffect(() => {
    if (!active || status !== "ready") return;
    let alive = true;
    let counter = 0;
    let frameKey = "";
    let doneKey = "";
    let rate = 0;
    let lastDone = performance.now();
    const scratch = document.createElement("canvas");

    const run = async (): Promise<void> => {
      const model = await loadModel();
      while (alive) {
        const frame = getFrame();
        if (!frame) {
          await nextFrame();
          await new Promise((r) => setTimeout(r, 120));
          continue;
        }
        if (frame.key !== frameKey) {
          frameKey = frame.key;
          doneKey = "";
          tracksRef.current = [];
        }
        // A still image needs one pass. Camera and video frames are detected as fast as the model allows.
        if (frame.kind === "image" && doneKey === frame.key) {
          await new Promise((r) => setTimeout(r, 200));
          continue;
        }
        // The model reads an <img> at its on-screen size, so an image is copied to a canvas at full size first.
        // Video frames already report their own pixel size.
        let input: HTMLVideoElement | HTMLCanvasElement;
        if (frame.el instanceof HTMLImageElement) {
          scratch.width = frame.width;
          scratch.height = frame.height;
          scratch.getContext("2d")?.drawImage(frame.el, 0, 0);
          input = scratch;
        } else {
          input = frame.el;
        }
        const found = await model.detect(input, MAX_BOXES, MIN_SCORE);
        if (!alive) return;
        const now = performance.now();
        const detections: Detection[] = found.map((d) => ({ cls: d.class, score: d.score, box: { x: d.bbox[0], y: d.bbox[1], w: d.bbox[2], h: d.bbox[3] } }));
        tracksRef.current = updateTracks(tracksRef.current, detections, now, frame.kind === "image" ? Infinity : LIVE_TTL_MS, () => ++counter);
        doneKey = frame.key;

        const instant = 1000 / Math.max(1, now - lastDone);
        rate = rate === 0 ? instant : rate * 0.8 + instant * 0.2;
        lastDone = now;
        const live = tracksRef.current.filter((t) => now - t.lastSeen <= COUNT_WINDOW_MS);
        const next: VisionStats = {
          people: live.filter((t) => groupOf(t.cls) === "person").length,
          vehicles: live.filter((t) => groupOf(t.cls) === "vehicle").length,
          objects: live.filter((t) => groupOf(t.cls) === "object").length,
          fps: frame.kind === "image" ? 0 : Math.round(rate),
        };
        setStats((prev) => (prev.people === next.people && prev.vehicles === next.vehicles && prev.objects === next.objects && prev.fps === next.fps ? prev : next));
        await nextFrame();
      }
    };
    void run().catch((err: unknown) => {
      if (!alive) return;
      setStatus("error");
      setError(err instanceof Error ? err.message : String(err));
    });
    return () => {
      alive = false;
    };
  }, [active, status, getFrame]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { status, error, retry, tracksRef, stats };
}
