import jsQR from "jsqr";
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { sfx } from "../../app/core/sound";
import type { Frame, GetFrame } from "./types";

interface Point {
  x: number;
  y: number;
}

/** What the browser's barcode API returns for one code. Not in TypeScript's DOM types yet. */
interface DetectedBarcode {
  rawValue: string;
  cornerPoints: Point[];
}
interface BarcodeDetectorLike {
  detect: (source: CanvasImageSource) => Promise<DetectedBarcode[]>;
}
type BarcodeDetectorCtor = (new (options: { formats: string[] }) => BarcodeDetectorLike) & { getSupportedFormats?: () => Promise<string[]> };

export type Decoder = "BarcodeDetector" | "jsQR";

export interface QrHit {
  text: string;
  /** Corners in source pixels, clockwise from top left. */
  corners: Point[];
}

export interface QrLock extends QrHit {
  /** When this code was first locked, for the lock-on animation. */
  since: number;
  lastSeen: number;
}

export interface QrScanner {
  decoder: Decoder | null;
  /** The latest decoded code. Stays after the code leaves the picture. */
  result: { text: string; at: number } | null;
  /** True once a still image has been searched and held no code. */
  empty: boolean;
  clear: () => void;
  lockRef: RefObject<QrLock | null>;
}

const SAMPLE_MS = 130;
const RELOCK_MS = 2500;
const LIVE_MAX_SIDE = 720;
const STILL_MAX_SIDE = 1400;

async function createDetector(): Promise<BarcodeDetectorLike | null> {
  const Ctor = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
  if (!Ctor) return null;
  try {
    const formats = (await Ctor.getSupportedFormats?.()) ?? ["qr_code"];
    return formats.includes("qr_code") ? new Ctor({ formats: ["qr_code"] }) : null;
  } catch {
    return null;
  }
}

function decodeWithJsQr(frame: Frame, canvas: HTMLCanvasElement): QrHit | null {
  const still = frame.kind === "image";
  const k = Math.min(1, (still ? STILL_MAX_SIDE : LIVE_MAX_SIDE) / Math.max(frame.width, frame.height));
  const w = Math.max(1, Math.round(frame.width * k));
  const h = Math.max(1, Math.round(frame.height * k));
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(frame.el, 0, 0, w, h);
  const code = jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: still ? "attemptBoth" : "dontInvert" });
  if (!code?.data) return null;
  const { topLeftCorner: a, topRightCorner: b, bottomRightCorner: c, bottomLeftCorner: d } = code.location;
  return { text: code.data, corners: [a, b, c, d].map((p) => ({ x: p.x / k, y: p.y / k })) };
}

export function useQr(getFrame: GetFrame, active: boolean): QrScanner {
  const [decoder, setDecoder] = useState<Decoder | null>(null);
  const [result, setResult] = useState<QrScanner["result"]>(null);
  const [empty, setEmpty] = useState(false);
  const lockRef = useRef<QrLock | null>(null);
  /** A code the user cleared. It stays hidden until it has been out of the picture for a while. */
  const dismissedRef = useRef<{ text: string; seen: number } | null>(null);

  useEffect(() => {
    if (!active) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let frameKey = "";
    let searched = "";
    let detector: BarcodeDetectorLike | null = null;
    const scratch = document.createElement("canvas");

    const run = async (): Promise<void> => {
      detector = await createDetector();
      if (!alive) return;
      setDecoder(detector ? "BarcodeDetector" : "jsQR");

      const tick = async (): Promise<void> => {
        const frame = getFrame();
        if (frame && frame.key !== frameKey) {
          frameKey = frame.key;
          searched = "";
          lockRef.current = null;
          setEmpty(false);
        }
        if (frame && !(frame.kind === "image" && searched === frame.key)) {
          let hit: QrHit | null = null;
          if (detector) {
            try {
              const [code] = await detector.detect(frame.el);
              if (code?.rawValue) hit = { text: code.rawValue, corners: code.cornerPoints.map((p) => ({ x: p.x, y: p.y })) };
            } catch {
              // The platform detector can fail at run time (for example, no Vision framework). jsQR takes over.
              detector = null;
              setDecoder("jsQR");
            }
          }
          if (!detector && !hit) hit = decodeWithJsQr(frame, scratch);
          if (!alive) return;
          const now = performance.now();
          if (frame.kind === "image") {
            searched = frame.key;
            setEmpty(!hit);
          }
          const dismissed = dismissedRef.current;
          if (dismissed && hit?.text === dismissed.text) {
            dismissed.seen = now;
            hit = null;
          } else if (dismissed && now - dismissed.seen > RELOCK_MS) {
            dismissedRef.current = null;
          }
          if (hit) {
            const previous = lockRef.current;
            const fresh = !previous || previous.text !== hit.text || now - previous.lastSeen > RELOCK_MS;
            lockRef.current = { ...hit, since: fresh ? now : (previous?.since ?? now), lastSeen: now };
            if (fresh) {
              sfx.lock();
              setResult({ text: hit.text, at: Date.now() });
            }
          }
        }
        if (alive) timer = setTimeout(() => void tick(), SAMPLE_MS);
      };
      await tick();
    };
    void run();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [active, getFrame]);

  const clear = useCallback((): void => {
    const current = lockRef.current;
    if (current) dismissedRef.current = { text: current.text, seen: performance.now() };
    setResult(null);
    lockRef.current = null;
  }, []);

  return { decoder, result, empty, clear, lockRef };
}
