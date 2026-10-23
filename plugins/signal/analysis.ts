/** Pure signal maths for the Signal screen. Everything here takes plain arrays, so it is easy to test with synthetic audio. */

/** The quietest level shown. Silence is -Infinity in the analyser, which cannot be drawn or averaged. */
export const FLOOR_DB = -120;

const toDb = (amplitude: number): number => (amplitude <= 1e-6 ? FLOOR_DB : Math.max(FLOOR_DB, 20 * Math.log10(amplitude)));

export interface Level {
  /** Root-mean-square level in dB relative to full scale. */
  rmsDb: number;
  /** Highest single sample in dB relative to full scale. */
  peakDb: number;
}

/** Level of the most recent `windowSamples` samples. 125 ms is the "fast" window of a sound level meter. */
export function measureLevel(samples: Float32Array, windowSamples: number): Level {
  const start = Math.max(0, samples.length - windowSamples);
  let sum = 0;
  let peak = 0;
  for (let i = start; i < samples.length; i++) {
    const v = samples[i] ?? 0;
    sum += v * v;
    peak = Math.max(peak, Math.abs(v));
  }
  return { rmsDb: toDb(Math.sqrt(sum / (samples.length - start))), peakDb: toDb(peak) };
}

// ── Pitch ─────────────────────────────────────────────────────────

export interface Pitch {
  frequency: number;
  /** 0 to 1: how periodic the sound is. Pure notes score near 1, noise near 0. */
  clarity: number;
}

const PITCH_MIN_HZ = 30;
const PITCH_MAX_HZ = 1600;
/** Below this the input is room noise, and "pitch" would be a guess. */
const PITCH_GATE_DB = -52;
const PITCH_MIN_CLARITY = 0.8;

const FILTER_HALF = 32;
const filters = new Map<number, Float32Array>();

/** Low-pass for decimation: a Hann-windowed sinc that cuts at `cutoffHz`, so tones far above the pitch range cannot fold back into it. */
function lowPass(sampleRate: number, cutoffHz: number): Float32Array {
  const key = sampleRate * 1000 + cutoffHz;
  const cached = filters.get(key);
  if (cached) return cached;
  const taps = new Float32Array(2 * FILTER_HALF + 1);
  const normalised = (2 * cutoffHz) / sampleRate;
  let sum = 0;
  for (let k = 0; k < taps.length; k++) {
    const n = k - FILTER_HALF;
    const sinc = n === 0 ? 1 : Math.sin(Math.PI * normalised * n) / (Math.PI * normalised * n);
    taps[k] = sinc * (0.5 + 0.5 * Math.cos((Math.PI * n) / (FILTER_HALF + 1)));
    sum += taps[k] ?? 0;
  }
  for (let k = 0; k < taps.length; k++) taps[k] = (taps[k] ?? 0) / sum;
  filters.set(key, taps);
  return taps;
}

/**
 * Pitch by the normalised square difference function (McLeod): the first strong peak of the
 * autocorrelation, which avoids the octave errors plain autocorrelation makes on notes with a strong
 * second harmonic. Audio is low-passed and reduced to about 12 kHz first, which is plenty for 1.6 kHz and
 * keeps the loop cheap enough to run several times per second.
 */
export function detectPitch(samples: Float32Array, sampleRate: number): Pitch | null {
  const step = Math.max(1, Math.floor(sampleRate / 12_000));
  const rate = sampleRate / step;
  const maxLag = Math.floor(rate / PITCH_MIN_HZ);
  const available = Math.floor((samples.length - 2 * FILTER_HALF - 1) / step) + 1;
  const window = Math.min(2048, available - maxLag - 1);
  if (window < maxLag) return null;

  const taps = lowPass(sampleRate, Math.min(2800, rate * 0.35));
  const x = new Float32Array(window + maxLag + 1);
  const first = samples.length - 1 - FILTER_HALF - (x.length - 1) * step;
  let energy = 0;
  for (let i = 0; i < x.length; i++) {
    const centre = first + i * step;
    let acc = 0;
    for (let k = 0; k < taps.length; k++) acc += (taps[k] ?? 0) * (samples[centre + k - FILTER_HALF] ?? 0);
    x[i] = acc;
    if (i < window) energy += acc * acc;
  }
  if (toDb(Math.sqrt(energy / window)) < PITCH_GATE_DB) return null;

  const nsdf = new Float32Array(maxLag + 1);
  for (let lag = 1; lag <= maxLag; lag++) {
    let r = 0;
    let m = 0;
    for (let i = 0; i < window; i++) {
      const a = x[i] ?? 0;
      const b = x[i + lag] ?? 0;
      r += a * b;
      m += a * a + b * b;
    }
    nsdf[lag] = m > 0 ? (2 * r) / m : 0;
  }

  // Skip the lobe around lag 0, then take the highest point of each positive stretch.
  let lag = 1;
  while (lag < maxLag && (nsdf[lag] ?? 0) > 0) lag++;
  const peaks: number[] = [];
  let best = 0;
  while (lag < maxLag) {
    while (lag < maxLag && (nsdf[lag] ?? 0) <= 0) lag++;
    let top = lag;
    while (lag < maxLag && (nsdf[lag] ?? 0) > 0) {
      if ((nsdf[lag] ?? 0) > (nsdf[top] ?? 0)) top = lag;
      lag++;
    }
    if ((nsdf[top] ?? 0) > 0 && top > 1) {
      peaks.push(top);
      best = Math.max(best, nsdf[top] ?? 0);
    }
  }
  const chosen = peaks.find((p) => (nsdf[p] ?? 0) >= 0.93 * best);
  if (chosen === undefined || best < PITCH_MIN_CLARITY) return null;

  const a = nsdf[chosen - 1] ?? 0;
  const b = nsdf[chosen] ?? 0;
  const c = nsdf[chosen + 1] ?? 0;
  const bend = a - 2 * b + c;
  const refined = bend === 0 ? chosen : chosen + (0.5 * (a - c)) / bend;
  const frequency = rate / refined;
  if (frequency < PITCH_MIN_HZ || frequency > PITCH_MAX_HZ) return null;
  return { frequency, clarity: b };
}

export interface Note {
  /** "C", "C♯", … */
  name: string;
  octave: number;
  /** How far the pitch is from the note, -50 to +50. */
  cents: number;
  /** Frequency of the note itself, A4 = 440 Hz. */
  target: number;
}

const NOTE_NAMES = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"] as const;

export function noteFor(frequency: number): Note {
  const midi = 69 + 12 * Math.log2(frequency / 440);
  const nearest = Math.round(midi);
  return {
    name: NOTE_NAMES[((nearest % 12) + 12) % 12] ?? "A",
    octave: Math.floor(nearest / 12) - 1,
    cents: Math.round((midi - nearest) * 100),
    target: 440 * 2 ** ((nearest - 69) / 12),
  };
}

// ── Spectrum ──────────────────────────────────────────────────────

export interface Tone {
  frequency: number;
  /** Level of the peak bin, dB relative to full scale. */
  db: number;
  /** dB above the median of the searched band. */
  prominence: number;
}

/** Parabola through the peak bin and its neighbours: finer than the bin width. */
function refinePeak(spectrum: Float32Array, bin: number): number {
  const a = Math.max(FLOOR_DB, spectrum[bin - 1] ?? FLOOR_DB);
  const b = Math.max(FLOOR_DB, spectrum[bin] ?? FLOOR_DB);
  const c = Math.max(FLOOR_DB, spectrum[bin + 1] ?? FLOOR_DB);
  const bend = a - 2 * b + c;
  return bend === 0 ? bin : bin + (0.5 * (a - c)) / bend;
}

/** The loudest frequency in the spectrum between `fromHz` and `toHz`. */
export function strongestTone(spectrum: Float32Array, binHz: number, fromHz: number, toHz: number): { frequency: number; db: number } | null {
  const first = Math.max(1, Math.ceil(fromHz / binHz));
  const last = Math.min(spectrum.length - 2, Math.floor(toHz / binHz));
  let top = -1;
  for (let i = first; i <= last; i++) if (top === -1 || (spectrum[i] ?? FLOOR_DB) > (spectrum[top] ?? FLOOR_DB)) top = i;
  const db = top === -1 ? FLOOR_DB : (spectrum[top] ?? FLOOR_DB);
  if (top === -1 || db <= FLOOR_DB) return null;
  return { frequency: refinePeak(spectrum, top) * binHz, db };
}

/** A narrow tone must beat the band's median by this much, and its own surroundings by FLANK_DB. */
const TONE_PROMINENCE_DB = 15;
const FLANK_DB = 12;
/** Louder than the noise floor of a good microphone's top octave. */
const TONE_FLOOR_DB = -95;
/** Peaks closer than this are one tone. */
const TONE_SEPARATION_HZ = 150;

/**
 * Narrow, steady peaks in a band: what a pilot tone or a near-ultrasonic beacon looks like, as opposed to
 * broadband hiss. A peak counts when it is a local maximum, 15 dB above the band's median and 12 dB above
 * the bins 8 to 16 away on both sides (a pure tone is only a few bins wide).
 */
export function findTones(spectrum: Float32Array, binHz: number, fromHz: number, toHz: number): Tone[] {
  const first = Math.max(20, Math.ceil(fromHz / binHz));
  const last = Math.min(spectrum.length - 21, Math.floor(toHz / binHz));
  if (last - first < 40) return [];

  const band = Float32Array.from({ length: last - first + 1 }, (_, i) => Math.max(FLOOR_DB, spectrum[first + i] ?? FLOOR_DB)).sort();
  const median = band[band.length >> 1] ?? FLOOR_DB;

  const found: Tone[] = [];
  for (let i = first; i <= last; i++) {
    const db = Math.max(FLOOR_DB, spectrum[i] ?? FLOOR_DB);
    if (db < TONE_FLOOR_DB || db - median < TONE_PROMINENCE_DB) continue;
    let isPeak = true;
    for (let k = 1; k <= 3; k++) if ((spectrum[i - k] ?? FLOOR_DB) > db || (spectrum[i + k] ?? FLOOR_DB) > db) isPeak = false;
    if (!isPeak) continue;
    let flank = 0;
    for (let k = 8; k <= 16; k++) flank += Math.max(FLOOR_DB, spectrum[i - k] ?? FLOOR_DB) + Math.max(FLOOR_DB, spectrum[i + k] ?? FLOOR_DB);
    if (db - flank / 18 < FLANK_DB) continue;
    found.push({ frequency: refinePeak(spectrum, i) * binHz, db, prominence: db - median });
  }

  const tones: Tone[] = [];
  for (const tone of found.sort((a, b) => b.prominence - a.prominence)) {
    if (tones.every((t) => Math.abs(t.frequency - tone.frequency) > TONE_SEPARATION_HZ)) tones.push(tone);
    if (tones.length === 3) break;
  }
  return tones;
}

/** The loudest bin of each of `columns` equal slices of the band: a small picture of its shape. */
export function bandShape(spectrum: Float32Array, binHz: number, fromHz: number, toHz: number, columns: number): number[] {
  const first = Math.ceil(fromHz / binHz);
  const last = Math.min(spectrum.length - 1, Math.floor(toHz / binHz));
  const width = (last - first + 1) / columns;
  return Array.from({ length: columns }, (_, c) => {
    const from = first + Math.floor(c * width);
    const to = Math.min(last, Math.max(from, first + Math.ceil((c + 1) * width) - 1));
    let top = FLOOR_DB;
    for (let i = from; i <= to; i++) top = Math.max(top, spectrum[i] ?? FLOOR_DB);
    return top;
  });
}
