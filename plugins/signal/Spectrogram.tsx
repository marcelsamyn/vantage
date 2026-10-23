import { useEffect, useImperativeHandle, useRef, useState, type ReactElement, type ReactNode, type Ref } from "react";
import { FLOOR_DB } from "./analysis";

export interface SpectrogramHandle {
  /** Draw one frame: the live spectrum line, and one new row at the top of the waterfall. */
  push: (spectrum: Float32Array, binHz: number, dt: number) => void;
  /** Blank both plots. */
  reset: () => void;
}

export const AXIS_MIN_HZ = 20;
export const AXIS_MAX_HZ = 20_000;
/** Quietest and loudest level on the colour ramp and the line plot, in dBFS. */
const DB_MIN = -100;
const DB_MAX = -20;
const LINE_MAX = -10;
/** Waterfall scroll speed in CSS pixels per second. */
const SCROLL_PX_PER_S = 36;
const SPECTRUM_HEIGHT = 150;

const FREQ_LABELS: readonly { hz: number; text: string }[] = [
  { hz: 20, text: "20" },
  { hz: 50, text: "50" },
  { hz: 100, text: "100" },
  { hz: 200, text: "200" },
  { hz: 500, text: "500" },
  { hz: 1000, text: "1k" },
  { hz: 2000, text: "2k" },
  { hz: 5000, text: "5k" },
  { hz: 10_000, text: "10k" },
  { hz: 20_000, text: "20k" },
];

/** Position on the log axis, 0 at 20 Hz and 1 at 20 kHz. */
export const axisPosition = (hz: number): number => Math.log(hz / AXIS_MIN_HZ) / Math.log(AXIS_MAX_HZ / AXIS_MIN_HZ);

/** The colour ramp: void, ice, bone, and sodium for the loudest. */
const RAMP: readonly (readonly [number, number, number, number])[] = [
  [0, 5, 7, 10],
  [0.4, 130, 228, 255],
  [0.72, 230, 236, 240],
  [1, 255, 181, 71],
];

function buildRamp(): Uint32Array {
  const lut = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    let k = 0;
    while (k < RAMP.length - 2 && t > (RAMP[k + 1]?.[0] ?? 1)) k++;
    const a = RAMP[k] ?? RAMP[0]!;
    const b = RAMP[k + 1] ?? a;
    const f = (t - a[0]) / (b[0] - a[0]);
    const mix = (n: 1 | 2 | 3): number => Math.round(a[n] + (b[n] - a[n]) * f);
    lut[i] = (255 << 24) | (mix(3) << 16) | (mix(2) << 8) | mix(1);
  }
  return lut;
}

interface Mapping {
  key: string;
  /** Fractional FFT bin at the left and right edge of each pixel column. */
  lo: Float32Array;
  hi: Float32Array;
}

/** Each pixel column covers a slice of the log axis, which at the top is many FFT bins wide: take the loudest. */
function mappingFor(width: number, binHz: number): Mapping {
  const lo = new Float32Array(width);
  const hi = new Float32Array(width);
  const ratio = AXIS_MAX_HZ / AXIS_MIN_HZ;
  for (let x = 0; x < width; x++) {
    lo[x] = (AXIS_MIN_HZ * ratio ** ((x - 0.5) / width)) / binHz;
    hi[x] = (AXIS_MIN_HZ * ratio ** ((x + 0.5) / width)) / binHz;
  }
  return { key: `${width}:${binHz}`, lo, hi };
}

const level = (spectrum: Float32Array, bin: number): number => Math.max(FLOOR_DB, spectrum[bin] ?? FLOOR_DB);

function column(spectrum: Float32Array, lo: number, hi: number): number {
  if (lo >= spectrum.length - 1) return FLOOR_DB;
  if (hi - lo < 1) {
    const centre = (lo + hi) / 2;
    const i = Math.floor(centre);
    const f = centre - i;
    return level(spectrum, i) * (1 - f) + level(spectrum, i + 1) * f;
  }
  let top = FLOOR_DB;
  for (let i = Math.ceil(lo); i <= Math.min(spectrum.length - 1, Math.floor(hi)); i++) top = Math.max(top, level(spectrum, i));
  return top;
}

/**
 * The hero plot: a live spectrum line above a scrolling waterfall that share one log frequency axis, so a
 * tone sits in the same column in both. Time runs downward; the newest row is at the top.
 */
export function Spectrogram({ ref, children }: { ref: Ref<SpectrogramHandle>; children?: ReactNode }): ReactElement {
  const plot = useRef<HTMLDivElement>(null);
  const lineCanvas = useRef<HTMLCanvasElement>(null);
  const fallCanvas = useRef<HTMLCanvasElement>(null);
  const [seconds, setSeconds] = useState(0);
  const draw = useRef({
    ramp: buildRamp(),
    mapping: null as Mapping | null,
    columns: new Float32Array(0),
    peaks: new Float32Array(0),
    row: null as ImageData | null,
    carry: 0,
  });

  useEffect(() => {
    const host = plot.current;
    const line = lineCanvas.current;
    const fall = fallCanvas.current;
    if (!host || !line || !fall) return;
    const fit = (): void => {
      const dpr = devicePixelRatio;
      const width = Math.max(1, Math.round(host.clientWidth * dpr));
      if (line.width === width && fall.width === width && fall.height === Math.round(fall.clientHeight * dpr)) return;
      line.width = width;
      line.height = Math.round(SPECTRUM_HEIGHT * dpr);
      fall.width = width;
      fall.height = Math.max(1, Math.round(fall.clientHeight * dpr));
      const d = draw.current;
      d.mapping = null;
      d.columns = new Float32Array(width);
      d.peaks = new Float32Array(width).fill(FLOOR_DB);
      d.row = null;
      blank(fall);
      setSeconds(Math.round(fall.clientHeight / SCROLL_PX_PER_S));
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  useImperativeHandle(ref, () => ({
    push(spectrum, binHz, dt) {
      const line = lineCanvas.current;
      const fall = fallCanvas.current;
      const lctx = line?.getContext("2d");
      const fctx = fall?.getContext("2d", { willReadFrequently: false });
      if (!line || !fall || !lctx || !fctx) return;
      const d = draw.current;
      const width = fall.width;
      if (d.mapping?.key !== `${width}:${binHz}`) d.mapping = mappingFor(width, binHz);
      const { lo, hi } = d.mapping;
      for (let x = 0; x < width; x++) d.columns[x] = column(spectrum, lo[x] ?? 0, hi[x] ?? 0);
      drawLine(lctx, line, d.columns, d.peaks, dt);
      scroll(fctx, fall, d, dt);
    },
    reset() {
      const line = lineCanvas.current;
      const fall = fallCanvas.current;
      line?.getContext("2d")?.clearRect(0, 0, line.width, line.height);
      if (fall) blank(fall);
      draw.current.peaks.fill(FLOOR_DB);
    },
  }));

  return (
    <div className="signal-plot" ref={plot}>
      <div className="signal-stage">
        <canvas ref={lineCanvas} className="signal-spectrum" aria-label="Live spectrum" role="img" />
        <canvas ref={fallCanvas} className="signal-waterfall" aria-label="Spectrogram: frequency across, time running downward" role="img" />
        <div className="signal-guides" aria-hidden>
          <span className="signal-band" style={{ left: `${axisPosition(17_500) * 100}%` }} />
          {FREQ_LABELS.map(({ hz }) => (
            <span key={hz} className="signal-guide" style={{ left: `${axisPosition(hz) * 100}%` }} />
          ))}
        </div>
        {children}
      </div>
      <div className="signal-freqs" aria-hidden>
        {FREQ_LABELS.map(({ hz, text }) => (
          <span key={hz} className="signal-freq" data-edge={hz === AXIS_MIN_HZ ? "start" : hz === AXIS_MAX_HZ ? "end" : undefined} style={{ left: `${axisPosition(hz) * 100}%` }}>
            {text}
          </span>
        ))}
      </div>
      <div className="signal-legend" aria-hidden>
        <span>{DB_MIN} dB</span>
        <span className="signal-ramp" />
        <span>{DB_MAX} dB</span>
        <span className="signal-legend__note">Newest at the top, about {seconds} s of history. Red band: 17.5 kHz and up, where beacons live.</span>
      </div>
    </div>
  );
}

function blank(canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.fillStyle = "#05070a";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}

function drawLine(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, columns: Float32Array, peaks: Float32Array, dt: number): void {
  const { width, height } = canvas;
  const dpr = devicePixelRatio;
  const y = (db: number): number => height - ((Math.min(LINE_MAX, Math.max(DB_MIN, db)) - DB_MIN) / (LINE_MAX - DB_MIN)) * (height - 2 * dpr) - dpr;
  ctx.clearRect(0, 0, width, height);

  ctx.font = `${10 * dpr}px "Plex Mono", monospace`;
  ctx.textBaseline = "bottom";
  for (const db of [-20, -40, -60, -80]) {
    ctx.strokeStyle = "rgba(226, 234, 240, 0.07)";
    ctx.lineWidth = dpr;
    ctx.beginPath();
    ctx.moveTo(0, Math.round(y(db)) + 0.5);
    ctx.lineTo(width, Math.round(y(db)) + 0.5);
    ctx.stroke();
    ctx.fillStyle = "rgba(139, 151, 163, 0.8)";
    ctx.fillText(`${db}`, 6 * dpr, y(db) - 2 * dpr);
  }

  for (let x = 0; x < width; x++) peaks[x] = Math.max(columns[x] ?? FLOOR_DB, (peaks[x] ?? FLOOR_DB) - dt * 14);
  ctx.strokeStyle = "rgba(230, 236, 240, 0.28)";
  ctx.lineWidth = dpr;
  ctx.beginPath();
  for (let x = 0; x < width; x++) (x === 0 ? ctx.moveTo(x, y(peaks[x] ?? FLOOR_DB)) : ctx.lineTo(x, y(peaks[x] ?? FLOOR_DB)));
  ctx.stroke();

  const fill = ctx.createLinearGradient(0, 0, 0, height);
  fill.addColorStop(0, "rgba(130, 228, 255, 0.32)");
  fill.addColorStop(1, "rgba(130, 228, 255, 0)");
  ctx.beginPath();
  ctx.moveTo(0, height);
  for (let x = 0; x < width; x++) ctx.lineTo(x, y(columns[x] ?? FLOOR_DB));
  ctx.lineTo(width, height);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();

  ctx.strokeStyle = "#82e4ff";
  ctx.lineWidth = 1.4 * dpr;
  ctx.lineJoin = "round";
  ctx.beginPath();
  for (let x = 0; x < width; x++) (x === 0 ? ctx.moveTo(x, y(columns[x] ?? FLOOR_DB)) : ctx.lineTo(x, y(columns[x] ?? FLOOR_DB)));
  ctx.stroke();
}

/** Shift the waterfall down by the rows owed since the last frame and paint the newest spectrum into the gap at the top. */
function scroll(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, d: { ramp: Uint32Array; columns: Float32Array; row: ImageData | null; carry: number }, dt: number): void {
  const { width, height } = canvas;
  d.carry += dt * SCROLL_PX_PER_S * devicePixelRatio;
  const rows = Math.min(Math.floor(d.carry), height);
  if (rows < 1) return;
  d.carry -= rows;
  if (height > rows) ctx.drawImage(canvas, 0, 0, width, height - rows, 0, rows, width, height - rows);
  d.row ??= ctx.createImageData(width, 1);
  const pixels = new Uint32Array(d.row.data.buffer);
  for (let x = 0; x < width; x++) {
    const t = ((d.columns[x] ?? FLOOR_DB) - DB_MIN) / (DB_MAX - DB_MIN);
    pixels[x] = d.ramp[Math.round(Math.min(1, Math.max(0, t)) * 255)] ?? 0;
  }
  for (let r = 0; r < rows; r++) ctx.putImageData(d.row, 0, r);
}
