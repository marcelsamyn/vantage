import { create } from "zustand";
import { errorMessage } from "../../app/core/api";
import { duckMic } from "./audio";
import type { BirdClip } from "./types";

/**
 * Plays one bird call: the few seconds of a public BirdWeather recording in which the detector heard the species.
 * A microphone that is playing gets quieter meanwhile, and comes back when the clip ends.
 */

interface ClipState {
  /** Species id of the clip that is loading or playing. */
  playing: string | null;
  error: string | null;
}

export const useClip = create<ClipState>(() => ({ playing: null, error: null }));

let audio: HTMLAudioElement | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;

function finish(error: string | null = null): void {
  clearTimeout(timer);
  audio?.pause();
  duckMic(false);
  useClip.setState({ playing: null, error });
}

/** Play the call, or stop it when the same species is already playing. */
export function playClip(speciesId: string, clip: BirdClip): void {
  if (useClip.getState().playing === speciesId) {
    finish();
    return;
  }
  clearTimeout(timer);
  audio ??= new Audio();
  const el = audio;
  el.onloadedmetadata = () => {
    el.currentTime = clip.startS;
  };
  el.onended = () => finish();
  el.onerror = () => finish("The recording could not be loaded. BirdWeather may have removed it.");
  el.src = `/api/listen/birds/clip/${clip.key}`;
  useClip.setState({ playing: speciesId, error: null });
  duckMic(true);
  el.play().then(
    () => {
      // Seeking is allowed once metadata has loaded; the call is only a few seconds long.
      timer = setTimeout(() => finish(), (clip.endS - clip.startS) * 1000 + 250);
    },
    (err: unknown) => {
      if (err instanceof DOMException && err.name === "AbortError") return;
      finish(`The recording could not be played: ${errorMessage(err)}`);
    },
  );
}

/** Stop any clip, for example when the screen closes. */
export function stopClip(): void {
  if (useClip.getState().playing) finish();
}
