import { useEffect, useRef, type ReactElement } from "react";
import { useAnimationFrame, usePrefersReducedMotion } from "../../app/core/hooks";
import { getAnalyser, usePlayer } from "./audio";

/** Lowest and highest frequency drawn, in Hz. The axis is logarithmic: each octave gets the same height. */
const F_MIN = 60;
const F_MAX = 12_000;
const TICKS = [100, 250, 500, 1000, 2000, 4000, 8000] as const;
/** Scroll speed in CSS pixels per second. */
const SPEED = 44;
const SPEED_REDUCED = 18;

const tickLabel = (hz: number): string => (hz >= 1000 ? `${hz / 1000}k` : String(hz));
const tickTop = (hz: number): string => `${(1 - Math.log(hz / F_MIN) / Math.log(F_MAX / F_MIN)) * 100}%`;

/** Sound level as colour: dark, through amber, to the sodium of a live signal, to white-hot. */
const STOPS: readonly (readonly [number, number, number, number])[] = [
  [0, 5, 7, 10],
  [0.3, 38, 28, 14],
  [0.62, 196, 128, 42],
  [0.85, 255, 181, 71],
  [1, 230, 236, 240],
];

/** 256 colours packed as little-endian RGBA, ready to write straight into image data. */
const PALETTE: Uint32Array = (() => {
  const out = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    let k = 1;
    while (k < STOPS.length - 1 && (STOPS[k]?.[0] ?? 1) < t) k++;
    const lo = STOPS[k - 1] ?? STOPS[0];
    const hi = STOPS[k] ?? STOPS[STOPS.length - 1];
    if (!lo || !hi) continue;
    const f = (t - lo[0]) / (hi[0] - lo[0]);
    const mix = (a: number, b: number): number => Math.round(a + (b - a) * f);
    out[i] = (255 << 24) | (mix(lo[3], hi[3]) << 16) | (mix(lo[2], hi[2]) << 8) | mix(lo[1], hi[1]);
  }
  return out;
})();

interface Scratch {
  /** Which FFT bin feeds each pixel row, top row first. */
  bins: Int32Array;
  forAnalyser: AnalyserNode | null;
  spectrum: Uint8Array<ArrayBuffer>;
  carry: number;
}

/** A live spectrogram of the microphone: time runs right to left, pitch runs bottom to top. */
export function Spectrogram(): ReactElement {
  const canvas = useRef<HTMLCanvasElement>(null);
  const phase = usePlayer((s) => s.phase);
  const micId = usePlayer((s) => s.mic?.id);
  const reduced = usePrefersReducedMotion();
  const scratch = useRef<Scratch>({ bins: new Int32Array(0), forAnalyser: null, spectrum: new Uint8Array(0), carry: 0 });

  // Keep the drawing buffer one device pixel per canvas pixel at any size.
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const fit = (): void => {
      const dpr = window.devicePixelRatio || 1;
      const w = Math.max(1, Math.round(el.clientWidth * dpr));
      const h = Math.max(1, Math.round(el.clientHeight * dpr));
      if (el.width === w && el.height === h) return;
      el.width = w;
      el.height = h;
      scratch.current.forAnalyser = null;
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // A new microphone starts on a clean sheet.
  useEffect(() => {
    const el = canvas.current;
    el?.getContext("2d")?.clearRect(0, 0, el.width, el.height);
  }, [micId]);

  useAnimationFrame((dt) => {
    const el = canvas.current;
    const analyser = getAnalyser();
    const ctx = el?.getContext("2d");
    if (!el || !analyser || !ctx || phase !== "playing") return;
    const st = scratch.current;
    const dpr = window.devicePixelRatio || 1;

    if (st.forAnalyser !== analyser) {
      st.forAnalyser = analyser;
      st.spectrum = new Uint8Array(analyser.frequencyBinCount);
      const hzPerBin = analyser.context.sampleRate / analyser.fftSize;
      st.bins = Int32Array.from({ length: el.height }, (_, y) => {
        const hz = F_MIN * (F_MAX / F_MIN) ** (1 - y / el.height);
        return Math.min(analyser.frequencyBinCount - 1, Math.round(hz / hzPerBin));
      });
    }

    st.carry += dt * (reduced ? SPEED_REDUCED : SPEED) * dpr;
    const n = Math.floor(st.carry);
    if (n < 1) return;
    st.carry -= n;
    const step = Math.min(n, el.width);

    analyser.getByteFrequencyData(st.spectrum);
    ctx.drawImage(el, step, 0, el.width - step, el.height, 0, 0, el.width - step, el.height);
    const column = ctx.createImageData(step, el.height);
    const pixels = new Uint32Array(column.data.buffer);
    for (let y = 0; y < el.height; y++) {
      // On a log axis a high row spans many FFT bins. Take the loudest of them so thin tones do not vanish.
      const bin = st.bins[y] ?? 0;
      const above = y > 0 ? (st.bins[y - 1] ?? bin) : bin;
      let v = st.spectrum[bin] ?? 0;
      for (let b = bin + 1; b < above; b++) v = Math.max(v, st.spectrum[b] ?? 0);
      const colour = PALETTE[v] ?? 0;
      for (let x = 0; x < step; x++) pixels[y * step + x] = colour;
    }
    ctx.putImageData(column, el.width - step, 0);
    // Live data: it draws while the sound plays, whether or not anyone touches the page.
  }, phase === "playing", "data");

  return (
    <div className="listen-spectro" role="img" aria-label="Live spectrogram of the microphone: time runs right to left, pitch runs bottom to top">
      <canvas ref={canvas} className="listen-spectro__canvas" />
      <div className="listen-spectro__axis" aria-hidden>
        {TICKS.map((hz) => (
          <span key={hz} style={{ top: tickTop(hz) }}>
            {tickLabel(hz)}
          </span>
        ))}
      </div>
      {phase === "idle" && micId === undefined && <div className="listen-spectro__idle">Pick a glowing point on the map and its sound will draw itself here.</div>}
    </div>
  );
}
