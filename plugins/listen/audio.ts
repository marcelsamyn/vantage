import { create } from "zustand";
import { api, errorMessage } from "../../app/core/api";
import { readStored, writeStored } from "../../app/core/hooks";
import { sfx } from "../../app/core/sound";
import type { HlsPlaylist, Microphone } from "./types";
import { claimSpeaker, releaseSpeaker } from "../../app/core/speaker";

/**
 * The microphone player. One audio element plays a Locustream or Orcasound microphone; an analyser behind it
 * feeds the spectrogram. The stream is tried directly first, so no audio passes through this server. When it
 * lacks the cross-origin headers that Web Audio needs, playback restarts through `/api/listen/stream/<id>`.
 */

export type Phase = "idle" | "connecting" | "playing" | "error";
export type Route = "direct" | "relay" | "hls";

interface PlayerState {
  mic: Microphone | null;
  phase: Phase;
  route: Route | null;
  error: string | null;
  /** 0 to 1. */
  volume: number;
}

export const usePlayer = create<PlayerState>(() => ({ mic: null, phase: "idle", route: null, error: null, volume: readStored("listen.volume", 0.8) }));

interface Graph {
  audio: HTMLAudioElement;
  context: AudioContext;
  analyser: AnalyserNode;
  gain: GainNode;
}

type HlsPlayer = { destroy: () => void };

let graph: Graph | null = null;
let hls: HlsPlayer | null = null;
/** Bumped on every play and stop, so a late event from an old stream cannot change the new state. */
let attempt = 0;
let stalled: ReturnType<typeof setTimeout> | undefined;
let ducked = false;

/** A live stream that sends nothing for this long has failed; the browser alone would wait forever. */
const STALL_LIMIT_MS = 15_000;
const DUCK_GAIN = 0.12;

/** Volume is a gain after the analyser, so the spectrogram reads the same signal at any volume. */
const gainFor = (volume: number): number => volume * volume;
const relayUrl = (mic: Microphone): string => `/api/listen/stream/${mic.id}`;

function applyGain(g: Graph): void {
  g.gain.gain.setTargetAtTime(gainFor(usePlayer.getState().volume) * (ducked ? DUCK_GAIN : 1), g.context.currentTime, 0.04);
}

/** Created on the first play, which is a user gesture, as browsers require before audio can start. */
function ensureGraph(): Graph {
  if (graph) return graph;
  const audio = new Audio();
  audio.preload = "none";
  audio.crossOrigin = "anonymous";
  const context = new AudioContext();
  const analyser = context.createAnalyser();
  analyser.fftSize = 4096;
  analyser.smoothingTimeConstant = 0.6;
  analyser.minDecibels = -100;
  analyser.maxDecibels = -40;
  const gain = context.createGain();
  gain.gain.value = gainFor(usePlayer.getState().volume);
  context.createMediaElementSource(audio).connect(analyser);
  analyser.connect(gain).connect(context.destination);

  audio.addEventListener("playing", () => {
    clearStall();
    const was = usePlayer.getState().phase;
    usePlayer.setState({ phase: "playing", error: null });
    if (was === "connecting" && !announced) {
      announced = true;
      sfx.lock();
    }
  });
  audio.addEventListener("waiting", () => {
    if (usePlayer.getState().phase === "playing") usePlayer.setState({ phase: "connecting" });
    watchStall();
  });
  audio.addEventListener("timeupdate", () => {
    if (usePlayer.getState().phase === "connecting" && !audio.paused) usePlayer.setState({ phase: "playing" });
  });
  audio.addEventListener("error", () => {
    if (audio.getAttribute("src")) void failed(attempt);
  });
  audio.addEventListener("ended", () => {
    if (usePlayer.getState().phase !== "idle") usePlayer.setState({ phase: "error", error: "The microphone ended its stream. Press Play to reconnect." });
  });

  graph = { audio, context, analyser, gain };
  return graph;
}

/** The sound cue plays once per started microphone, not each time a stream stalls and recovers. */
let announced = false;

function clearStall(): void {
  clearTimeout(stalled);
  stalled = undefined;
}

function watchStall(): void {
  clearStall();
  const mine = attempt;
  stalled = setTimeout(() => void failed(mine), STALL_LIMIT_MS);
}

/** Close the connection. Setting no source ends the download, which ends the relay's upstream connection too. */
function release(): void {
  clearStall();
  hls?.destroy();
  hls = null;
  if (!graph) return;
  graph.audio.pause();
  graph.audio.removeAttribute("src");
  graph.audio.load();
}

/** The direct stream did not work: try the relay once. If that fails too, or this is not a direct stream, say why. */
async function failed(mine: number): Promise<void> {
  if (mine !== attempt) return;
  const { mic, route } = usePlayer.getState();
  if (!mic || !graph) return;
  if (route === "direct") {
    start(mic, "relay");
    return;
  }
  release();
  const message = await explain(mic, route);
  // The explanation takes a round trip; a newer microphone may be playing by now, and its state must stand.
  if (mine !== attempt) return;
  usePlayer.setState({ phase: "error", error: message });
  void graph.context.suspend();
}

/** The browser only says "could not load". Ask the server why, so the message names the real cause. */
async function explain(mic: Microphone, route: Route | null): Promise<string> {
  const generic = `The ${mic.place} microphone could not be played. It may be offline, or use a format this browser cannot decode.`;
  if (route === "hls") return generic;
  const res = await fetch(relayUrl(mic)).catch(() => null);
  let message = generic;
  if (res && !res.ok) {
    const body: unknown = await res.json().catch(() => null);
    if (typeof body === "object" && body !== null && "error" in body) message = (body as { error: { message: string } }).error.message;
  }
  // A healthy relay answers with audio that never ends: drop it without reading.
  await res?.body?.cancel();
  return message;
}

function start(mic: Microphone, route: "direct" | "relay"): void {
  const g = ensureGraph();
  clearStall();
  hls?.destroy();
  hls = null;
  usePlayer.setState({ route, phase: "connecting", error: null });
  const url = route === "direct" ? mic.stream : relayUrl(mic);
  if (!url) {
    usePlayer.setState({ phase: "error", error: `The ${mic.place} microphone has no stream address.` });
    return;
  }
  g.audio.src = url;
  watchStall();
  void g.context.resume();
  g.audio.play().catch((err: unknown) => {
    // A newer play or stop replaced this load; it reports its own state.
    if (err instanceof DOMException && err.name === "AbortError") return;
    clearStall();
    usePlayer.setState({ phase: "error", error: `Playback was blocked: ${errorMessage(err)}` });
  });
}

async function startHls(mic: Microphone, mine: number): Promise<void> {
  const g = ensureGraph();
  usePlayer.setState({ route: "hls", phase: "connecting", error: null });
  watchStall();
  let playlist: HlsPlaylist;
  try {
    playlist = await api<HlsPlaylist>(`/api/listen/hls/${mic.id}`);
  } catch (err) {
    if (mine === attempt) {
      clearStall();
      usePlayer.setState({ phase: "error", error: errorMessage(err) });
    }
    return;
  }
  if (mine !== attempt) return;

  const { default: Hls } = await import("hls.js");
  if (mine !== attempt) return;
  void g.context.resume();
  if (Hls.isSupported()) {
    // Stay a few segments behind the live edge so a slow segment does not stall the sound.
    const player = new Hls({ liveSyncDurationCount: 3, enableWorker: true });
    hls = player;
    player.on(Hls.Events.ERROR, (_event, data) => {
      if (data.fatal && mine === attempt) void failed(mine);
    });
    player.loadSource(playlist.url);
    player.attachMedia(g.audio);
    player.on(Hls.Events.MANIFEST_PARSED, () => {
      void g.audio.play().catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        usePlayer.setState({ phase: "error", error: `Playback was blocked: ${errorMessage(err)}` });
      });
    });
  } else if (g.audio.canPlayType("application/vnd.apple.mpegurl")) {
    g.audio.src = playlist.url;
    void g.audio.play().catch(() => void failed(mine));
  } else {
    clearStall();
    usePlayer.setState({ phase: "error", error: "This browser cannot play live HLS audio. Safari, Chrome, Edge and Firefox can." });
  }
}

/** Play a microphone, replacing whatever was playing, including a radio station elsewhere in the app. */
export function playMic(mic: Microphone): void {
  claimSpeaker("listen", stopMic);
  attempt++;
  announced = false;
  release();
  usePlayer.setState({ mic, phase: "connecting", route: null, error: null });
  if (mic.format === "hls") void startHls(mic, attempt);
  else start(mic, "direct");
}

export function stopMic(): void {
  releaseSpeaker("listen");
  attempt++;
  release();
  // A running context keeps the audio hardware awake. Every play resumes it.
  void graph?.context.suspend();
  usePlayer.setState({ phase: "idle", route: null, error: null });
}

export function toggleMic(): void {
  const { mic, phase } = usePlayer.getState();
  if (!mic) return;
  if (phase === "playing" || phase === "connecting") stopMic();
  else playMic(mic);
}

export function setVolume(volume: number): void {
  usePlayer.setState({ volume });
  writeStored("listen.volume", volume);
  if (graph) applyGain(graph);
}

/** Lower the microphone while a bird clip plays over it. */
export function duckMic(on: boolean): void {
  ducked = on;
  if (graph) applyGain(graph);
}

/** The analyser behind the player, or null until a microphone has been played once. */
export function getAnalyser(): AnalyserNode | null {
  return graph?.analyser ?? null;
}

let timeBuffer: Uint8Array<ArrayBuffer> | null = null;

/** Loudness right now, 0 to 1 (RMS of the waveform), for things that should breathe with the sound. */
export function currentLevel(): number {
  const analyser = graph?.analyser;
  if (!analyser || usePlayer.getState().phase !== "playing") return 0;
  if (!timeBuffer || timeBuffer.length !== analyser.fftSize) timeBuffer = new Uint8Array(analyser.fftSize);
  analyser.getByteTimeDomainData(timeBuffer);
  let sum = 0;
  for (const v of timeBuffer) {
    const x = (v - 128) / 128;
    sum += x * x;
  }
  return Math.min(1, Math.sqrt(sum / timeBuffer.length) * 4);
}
