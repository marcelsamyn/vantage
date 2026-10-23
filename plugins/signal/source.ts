import { useCallback, useEffect, useRef, useState } from "react";
import { errorMessage } from "../../app/core/api";

export type SourceKind = "mic" | "file";

export type SourceStatus =
  /** Waiting for the user to start it. */
  | "idle"
  /** The browser is showing its permission prompt. */
  | "asking"
  | "live"
  | "blocked"
  | "error";

export interface SourceState {
  kind: SourceKind;
  status: SourceStatus;
  /** What went wrong and what to do about it. */
  message: string | null;
  /** The file name or microphone label. */
  label: string | null;
  analyser: AnalyserNode | null;
}

export interface Source {
  state: SourceState;
  /** Whether the audio file is currently playing. */
  filePlaying: boolean;
  select: (kind: SourceKind) => void;
  startMic: () => Promise<void>;
  openFile: (file: File) => void;
  toggleFile: () => void;
  /** Releases the microphone or file and returns to the start prompt. */
  stop: () => void;
}

const FFT_SIZE = 8192;

function analyserFor(context: AudioContext): AnalyserNode {
  const analyser = context.createAnalyser();
  analyser.fftSize = FFT_SIZE;
  analyser.smoothingTimeConstant = 0.5;
  return analyser;
}

function micFailure(err: unknown): { status: SourceStatus; message: string } {
  const name = err instanceof DOMException ? err.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return { status: "blocked", message: "The browser blocked the microphone. Allow it from the lock icon in the address bar, then press Try again." };
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return { status: "error", message: "No microphone was found. Plug one in or choose another input in your system settings, then press Try again." };
  }
  if (name === "NotReadableError") {
    return { status: "error", message: "Another app is using the microphone. Close it and press Try again." };
  }
  return { status: "error", message: `The microphone could not be opened: ${errorMessage(err)}` };
}

/**
 * Owns the audio source behind the Signal screen: microphone or a local file.
 * Anything it opens is released when the source changes and when the screen unmounts, so the
 * microphone indicator never stays on after leaving.
 */
export function useSignalSource(): Source {
  const [state, setState] = useState<SourceState>({ kind: "mic", status: "idle", message: null, label: null, analyser: null });
  const [filePlaying, setFilePlaying] = useState(false);
  const release = useRef<(() => void) | null>(null);
  const fileAudio = useRef<HTMLAudioElement | null>(null);
  /** Bumped on every change of source, so a slow permission prompt cannot revive a source the user left. */
  const generation = useRef(0);

  const releaseCurrent = useCallback((): void => {
    generation.current++;
    release.current?.();
    release.current = null;
    fileAudio.current = null;
    setFilePlaying(false);
  }, []);

  useEffect(() => releaseCurrent, [releaseCurrent]);

  const select = useCallback(
    (kind: SourceKind): void => {
      releaseCurrent();
      setState({ kind, status: "idle", message: null, label: null, analyser: null });
    },
    [releaseCurrent],
  );

  const startMic = useCallback(async (): Promise<void> => {
    releaseCurrent();
    const mine = generation.current;
    setState({ kind: "mic", status: "asking", message: null, label: null, analyser: null });
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new DOMException("Microphone access needs a secure page.", "NotSupportedError");
      // Raw input: echo cancellation, noise suppression and automatic gain would all distort level and spectrum.
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
      const context = new AudioContext();
      const cleanup = (): void => {
        for (const track of stream.getTracks()) track.stop();
        void context.close();
      };
      if (generation.current !== mine) {
        cleanup();
        return;
      }
      const analyser = analyserFor(context);
      context.createMediaStreamSource(stream).connect(analyser);
      void context.resume();
      release.current = cleanup;
      stream.getAudioTracks()[0]?.addEventListener("ended", () => {
        if (generation.current !== mine) return;
        releaseCurrent();
        setState({ kind: "mic", status: "error", message: "The microphone was disconnected. Plug it back in and press Try again.", label: null, analyser: null });
      });
      setState({ kind: "mic", status: "live", message: null, label: stream.getAudioTracks()[0]?.label || "Microphone", analyser });
    } catch (err) {
      if (generation.current === mine) setState({ kind: "mic", label: null, analyser: null, ...micFailure(err) });
    }
  }, [releaseCurrent]);

  const openFile = useCallback(
    (file: File): void => {
      releaseCurrent();
      const mine = generation.current;
      const url = URL.createObjectURL(file);
      const audio = new Audio(url);
      audio.loop = true;
      const context = new AudioContext();
      const analyser = analyserFor(context);
      context.createMediaElementSource(audio).connect(analyser);
      analyser.connect(context.destination);
      release.current = () => {
        audio.pause();
        audio.removeAttribute("src");
        audio.load();
        URL.revokeObjectURL(url);
        void context.close();
      };
      fileAudio.current = audio;
      audio.addEventListener("play", () => setFilePlaying(true));
      audio.addEventListener("pause", () => setFilePlaying(false));
      audio.addEventListener("error", () => {
        if (generation.current !== mine) return;
        releaseCurrent();
        setState({ kind: "file", status: "error", message: `${file.name} could not be decoded. Try a WAV, MP3, M4A or OGG file.`, label: null, analyser: null });
      });
      setState({ kind: "file", status: "live", message: null, label: file.name, analyser });
      void context.resume();
      void audio.play().catch((err: unknown) => {
        if (generation.current !== mine || (err instanceof DOMException && err.name === "AbortError")) return;
        setState((s) => ({ ...s, message: "Press play to start the file: the browser would not start it by itself." }));
      });
    },
    [releaseCurrent],
  );

  const toggleFile = useCallback((): void => {
    const audio = fileAudio.current;
    if (!audio) return;
    if (audio.paused) {
      void audio.play();
      setState((s) => ({ ...s, message: null }));
    } else audio.pause();
  }, []);

  const stop = useCallback((): void => {
    releaseCurrent();
    setState((s) => ({ kind: s.kind, status: "idle", message: null, label: null, analyser: null }));
  }, [releaseCurrent]);

  return { state, filePlaying, select, startMic, openFile, toggleFile, stop };
}
