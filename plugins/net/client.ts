import { useEffect } from "react";
import { create } from "zustand";
import { ApiError, api, errorMessage, post } from "../../app/core/api";
import { readStored, usePoll, writeStored, type Polled } from "../../app/core/hooks";
import { sfx } from "../../app/core/sound";
import type { NetCounters, NetDevices, NetOverview, SpeedEvent, SpeedPhase, SpeedResult, SweepResult, WifiInfo } from "./types";

// ── Plain fetchers and polling hooks ──────────────────────────────

export const useOverview = (): Polled<NetOverview> => usePoll((signal) => api<NetOverview>("/api/net/overview", { signal }), 5_000, []);

/** The Wi-Fi scan takes about 5 s on the server and is cached for 20 s, so polling faster gains nothing. */
export const useWifi = (intervalMs = 25_000): Polled<WifiInfo> => usePoll((signal) => api<WifiInfo>("/api/net/wifi", { signal }), intervalMs, []);

export const fetchDevices = (signal?: AbortSignal): Promise<NetDevices> => api<NetDevices>("/api/net/devices", { signal });

export const useDevices = (intervalMs = 45_000): Polled<NetDevices> => usePoll((signal) => fetchDevices(signal), intervalMs, []);

export const sweepNetwork = (signal?: AbortSignal): Promise<SweepResult> => post<SweepResult>("/api/net/sweep", {}, { signal });

// ── Latest device list, shared by the watcher, the tile and the Devices tab ──

interface DeviceStore {
  latest: NetDevices | null;
  set: (devices: NetDevices) => void;
}

export const useDeviceStore = create<DeviceStore>((set, get) => ({
  latest: null,
  set: (devices) => {
    if (!get().latest || devices.at >= (get().latest?.at ?? 0)) set({ latest: devices });
  },
}));

// ── Live throughput ───────────────────────────────────────────────

export interface RateSample {
  at: number;
  /** Bits per second received on the default interface. */
  down: number;
  /** Bits per second sent. */
  up: number;
}

interface RateStore {
  samples: RateSample[];
  /** Name of the interface that carries the default route, or null while offline. */
  primary: string | null;
  /** False when the server could not be reached or the Mac has no default route. */
  online: boolean;
  error: string | null;
}

export const useRates = create<RateStore>(() => ({ samples: [], primary: null, online: true, error: null }));

const HISTORY_MS = 120_000;
let previous: { at: number; name: string; rx: number; tx: number } | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
const subscribers = new Map<symbol, number>();

async function sampleRates(): Promise<void> {
  try {
    const counters = await api<NetCounters>("/api/net/counters");
    const mine = counters.primary ? counters.interfaces.find((i) => i.name === counters.primary) : undefined;
    if (!counters.primary || !mine) {
      previous = null;
      useRates.setState({ primary: counters.primary, online: false, error: null });
      return;
    }
    let sample: RateSample | null = null;
    if (previous && previous.name === mine.name && counters.at > previous.at) {
      const dt = (counters.at - previous.at) / 1000;
      const dRx = mine.rxBytes - previous.rx;
      const dTx = mine.txBytes - previous.tx;
      // A counter that went backwards means the interface was reset; skip that interval.
      if (dRx >= 0 && dTx >= 0) sample = { at: counters.at, down: (dRx * 8) / dt, up: (dTx * 8) / dt };
    }
    previous = { at: counters.at, name: mine.name, rx: mine.rxBytes, tx: mine.txBytes };
    useRates.setState((s) => ({
      primary: counters.primary,
      online: true,
      error: null,
      samples: sample ? [...s.samples.filter((x) => counters.at - x.at <= HISTORY_MS), sample] : s.samples,
    }));
  } catch (err) {
    useRates.setState({ online: false, error: errorMessage(err) });
  }
}

function schedule(): void {
  clearTimeout(timer);
  // Hidden: no timer at all. The visibility listener starts sampling again when the page shows.
  if (subscribers.size === 0 || document.visibilityState !== "visible") return;
  const every = Math.min(...subscribers.values());
  timer = setTimeout(async () => {
    await sampleRates();
    schedule();
  }, every);
}

/** Poll /counters while mounted. Components share one poller that runs at the fastest interval anyone asked for. */
export function useThroughput(intervalMs: number): RateStore {
  useEffect(() => {
    const id = Symbol("rates");
    const first = subscribers.size === 0;
    subscribers.set(id, intervalMs);
    if (first) {
      document.addEventListener("visibilitychange", schedule);
      void sampleRates().then(schedule);
    } else schedule();
    return () => {
      subscribers.delete(id);
      if (subscribers.size === 0) {
        document.removeEventListener("visibilitychange", schedule);
        clearTimeout(timer);
        previous = null;
      } else schedule();
    };
  }, [intervalMs]);
  return useRates();
}

// ── Speed test ────────────────────────────────────────────────────

export interface SpeedRecord {
  at: number;
  downMbps: number;
  upMbps: number;
  pingMs: number;
  jitterMs: number;
  colo: string | null;
}

const HISTORY_KEY = "net.speed.history";
const HISTORY_LIMIT = 20;

type SpeedStatus = "idle" | "running" | "done" | "error";

interface SpeedStore {
  status: SpeedStatus;
  phase: SpeedPhase | null;
  /** Overall progress 0 to 1 across the three phases. */
  progress: number;
  /** Live throughput in the current phase. */
  mbps: number;
  pingMs: number | null;
  /** Latest rate reported in each phase, so a finished phase keeps its number on screen until the final result. */
  phaseResults: Partial<Record<SpeedPhase, number>>;
  result: SpeedResult | null;
  error: string | null;
  history: SpeedRecord[];
  start: () => void;
  stop: () => void;
}

let controller: AbortController | null = null;
const PHASE_SPAN: Record<SpeedPhase, [number, number]> = { ping: [0, 0.1], download: [0.1, 0.6], upload: [0.6, 1] };

/** Read the NDJSON stream from /api/net/speed and hand each event to `onEvent`. */
async function streamSpeed(signal: AbortSignal, onEvent: (event: SpeedEvent) => void): Promise<void> {
  let res: Response;
  try {
    res = await fetch("/api/net/speed", { signal });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new ApiError(0, "offline", "The VANTAGE server is not running. Start it with `bun run dev`.");
  }
  if (!res.ok || !res.body) throw new ApiError(res.status, "http", `The speed test could not start (HTTP ${res.status}).`);
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    let nl = buffer.indexOf("\n");
    while (nl >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (line) onEvent(JSON.parse(line) as SpeedEvent);
      nl = buffer.indexOf("\n");
    }
  }
}

export const useSpeed = create<SpeedStore>((set, get) => ({
  status: "idle",
  phase: null,
  progress: 0,
  mbps: 0,
  pingMs: null,
  phaseResults: {},
  result: null,
  error: null,
  history: readStored<SpeedRecord[]>(HISTORY_KEY, []),

  start: () => {
    if (get().status === "running") return;
    controller = new AbortController();
    const signal = controller.signal;
    set({ status: "running", phase: "ping", progress: 0, mbps: 0, pingMs: null, phaseResults: {}, result: null, error: null });

    void streamSpeed(signal, (event) => {
      if ("error" in event) throw new ApiError(502, event.error.code, event.error.message);
      if (event.type === "progress") {
        const [from, to] = PHASE_SPAN[event.phase];
        set((s) => ({
          phase: event.phase,
          progress: from + (to - from) * event.progress,
          mbps: event.mbps,
          pingMs: event.pingMs ?? s.pingMs,
          phaseResults: event.phase === "ping" ? s.phaseResults : { ...s.phaseResults, [event.phase]: event.mbps },
        }));
        return;
      }
      const record: SpeedRecord = { at: event.at, downMbps: event.downMbps, upMbps: event.upMbps, pingMs: event.pingMs, jitterMs: event.jitterMs, colo: event.colo };
      const history = [...get().history, record].slice(-HISTORY_LIMIT);
      writeStored(HISTORY_KEY, history);
      set({ status: "done", phase: null, progress: 1, mbps: 0, result: event, history });
      sfx.notify();
    })
      .then(() => {
        if (get().status === "running") set({ status: "error", phase: null, error: "The speed test ended before it finished. Check your connection and run it again." });
      })
      .catch((err: unknown) => {
      if (err instanceof DOMException && err.name === "AbortError") return;
      set({ status: "error", phase: null, error: errorMessage(err) });
    });
  },

  stop: () => {
    controller?.abort();
    controller = null;
    set({ status: "idle", phase: null, progress: 0, mbps: 0 });
  },
}));
