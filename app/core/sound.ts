import { useSettings } from "./settings";

/**
 * Interface sounds, synthesised with Web Audio — no audio files.
 * Browsers only allow audio after a user gesture, so the context is created on the first pointer press.
 */

let ctx: AudioContext | null = null;
let master: GainNode | null = null;

function audio(): { ctx: AudioContext; out: GainNode } | null {
  const { sound, volume } = useSettings.getState();
  if (!sound || !ctx || !master) return null;
  master.gain.value = volume * 0.35;
  return { ctx, out: master };
}

function unlock(): void {
  if (ctx) return;
  ctx = new AudioContext();
  master = ctx.createGain();
  master.connect(ctx.destination);
}
window.addEventListener("pointerdown", unlock, { once: true, capture: true });
window.addEventListener("keydown", unlock, { once: true, capture: true });

function blip(freq: number, start: number, dur: number, gain: number, type: OscillatorType = "sine"): void {
  const a = audio();
  if (!a) return;
  const t = a.ctx.currentTime + start;
  const osc = a.ctx.createOscillator();
  const env = a.ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  env.gain.setValueAtTime(0, t);
  env.gain.linearRampToValueAtTime(gain, t + 0.004);
  env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(env).connect(a.out);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

function sweep(from: number, to: number, dur: number, gain: number): void {
  const a = audio();
  if (!a) return;
  const t = a.ctx.currentTime;
  const len = Math.ceil(a.ctx.sampleRate * dur);
  const buffer = a.ctx.createBuffer(1, len, a.ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = a.ctx.createBufferSource();
  src.buffer = buffer;
  const bp = a.ctx.createBiquadFilter();
  bp.type = "bandpass";
  bp.Q.value = 6;
  bp.frequency.setValueAtTime(from, t);
  bp.frequency.exponentialRampToValueAtTime(to, t + dur);
  const env = a.ctx.createGain();
  env.gain.setValueAtTime(gain, t);
  env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(bp).connect(env).connect(a.out);
  src.start(t);
}

export const sfx = {
  /** Hovering an interactive target. Barely there. */
  hover: () => blip(3200, 0, 0.018, 0.035),
  /** Pressing a control. */
  click: () => {
    blip(1800, 0, 0.03, 0.08);
    blip(2600, 0.025, 0.03, 0.05);
  },
  /** Switching modules: a short filtered-noise swipe. */
  open: () => sweep(700, 4200, 0.16, 0.12),
  /** The Profiler locking onto a target: three rising pips. */
  lock: () => {
    blip(1320, 0, 0.05, 0.09, "triangle");
    blip(1760, 0.06, 0.05, 0.09, "triangle");
    blip(2640, 0.12, 0.09, 0.08, "triangle");
  },
  notify: () => {
    blip(1480, 0, 0.07, 0.08, "triangle");
    blip(1975, 0.08, 0.12, 0.07, "triangle");
  },
  alert: () => {
    blip(880, 0, 0.12, 0.09, "square");
    blip(660, 0.14, 0.18, 0.08, "square");
  },
  boot: () => {
    sweep(120, 2400, 0.9, 0.14);
    [0, 0.12, 0.2, 0.31, 0.38, 0.52].forEach((s, i) => blip(900 + i * 260, 0.25 + s, 0.035, 0.05));
    blip(2093, 1.0, 0.35, 0.07, "triangle");
  },
};
