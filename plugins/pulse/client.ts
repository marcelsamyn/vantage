import { useEffect, useMemo, useRef, useState } from "react";
import { ApiError, api, qs } from "../../app/core/api";
import { useDocumentVisible, usePoll, useScreenActive, type Polled } from "../../app/core/hooks";
import { backoffMs } from "./backoff";
import type { MapView } from "../city/extension";
import type { BridgeFeed, CounterDetail, CounterFeed, MatrixFeed, Nearest, ParkingFeed, RiverFeed, RiverSeries, SignalDetail, SignalHeads, SignalStreamEvent } from "./types";

/** Browser client for /api/pulse. */

// ── NDJSON ────────────────────────────────────────────────────────

/** Read a newline-delimited JSON response and hand each line to `onLine`. Resolves when the server ends the stream. */
export async function readNdjson<T>(path: string, signal: AbortSignal, onLine: (line: T) => void): Promise<void> {
  const res = await fetch(path, { signal });
  if (!res.ok || !res.body) {
    const body: unknown = await res.json().catch(() => null);
    const message = typeof body === "object" && body !== null && "error" in body ? String((body as { error: { message?: unknown } }).error.message) : `HTTP ${res.status}`;
    throw new ApiError(res.status, "stream", message);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let rest = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      rest += decoder.decode(value, { stream: true });
      let cut = rest.indexOf("\n");
      while (cut >= 0) {
        const text = rest.slice(0, cut).trim();
        rest = rest.slice(cut + 1);
        if (text) {
          const parsed: unknown = JSON.parse(text);
          if (typeof parsed === "object" && parsed !== null && "error" in parsed) throw new ApiError(502, "stream", String((parsed as { error: { message?: unknown } }).error.message));
          onLine(parsed as T);
        }
        cut = rest.indexOf("\n");
      }
    }
  } finally {
    // A parse failure or an error line would leave the response open; cancelling a finished body does nothing.
    await reader.cancel().catch(() => undefined);
  }
}

const sleep = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    });
  });

// ── Traffic lights ────────────────────────────────────────────────

/** Heads at or above this zoom also get the lane drawn through the junction. */
export const ROUTE_ZOOM = 16.4;

export function useSignalHeads(view: MapView): Polled<SignalHeads> {
  // A pitched map reports a huge horizon. Only the stretch around the centre is worth loading, and the server caps heads anyway.
  const q = useMemo(
    () => ({ ...clampView(view, 0.03, 0.018), routes: view.zoom >= ROUTE_ZOOM ? "1" : "0" }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [view.west, view.south, view.east, view.north, view.zoom >= ROUTE_ZOOM],
  );
  return usePoll((signal) => api<SignalHeads>(qs("/api/pulse/signals", q), { signal }), 120_000, [q.west, q.south, q.east, q.north, q.routes]);
}

export interface StreamStatus {
  state: "idle" | "connecting" | "live" | "error";
  transport: "mqtt" | "poll" | null;
  error: string | null;
}

/** A connection that stayed open this long was healthy, even when no light changed. */
const STABLE_STREAM_MS = 30_000;

const IDLE: StreamStatus = { state: "idle", transport: null, error: null };

/**
 * Follow the live state of datastreams. The stream is open only while `enabled` and the page is visible, so a
 * hidden map or a closed layer costs the city's server nothing. Reconnects with backoff.
 */
export function useSignalStream(ids: readonly number[], enabled: boolean, onEvent: (event: SignalStreamEvent) => void): StreamStatus {
  const screenActive = useScreenActive();
  const visible = useDocumentVisible();
  const run = enabled && screenActive && visible && ids.length > 0;
  const key = ids.join(",");
  const handler = useRef(onEvent);
  handler.current = onEvent;
  const [status, setStatus] = useState<StreamStatus>(IDLE);

  useEffect(() => {
    if (!run) {
      setStatus(IDLE);
      return;
    }
    const controller = new AbortController();
    const { signal } = controller;
    setStatus((s) => ({ ...s, state: "connecting", error: null }));
    void (async () => {
      let failures = 0;
      while (!signal.aborted) {
        const openedAt = Date.now();
        try {
          await readNdjson<SignalStreamEvent>(`/api/pulse/signals/stream?ids=${key}`, signal, (e) => {
            // Only a state proves the city's server answers: the transport line and pings arrive before its REST call fails.
            if (e.t === "state") failures = 0;
            if (e.t === "transport") setStatus({ state: "live", transport: e.transport, error: null });
            handler.current(e);
          });
        } catch (err) {
          if (signal.aborted) return;
          setStatus((s) => ({ ...s, state: "error", error: err instanceof Error ? err.message : String(err) }));
        }
        if (signal.aborted) return;
        failures = Date.now() - openedAt >= STABLE_STREAM_MS ? 1 : failures + 1;
        await sleep(backoffMs(failures, 2_000, 30_000), signal);
      }
    })();
    return () => controller.abort();
  }, [run, key]);

  return status;
}

export function useSignalDetail(thing: number): Polled<SignalDetail> {
  return usePoll((signal) => api<SignalDetail>(qs("/api/pulse/signal", { thing }), { signal }), null, [thing]);
}

// ── Bridges, parking, counters, rivers ────────────────────────────

export const fetchBridges = (signal?: AbortSignal): Promise<BridgeFeed> => api<BridgeFeed>("/api/pulse/bridges", { signal });
export const fetchParking = (signal?: AbortSignal): Promise<ParkingFeed> => api<ParkingFeed>("/api/pulse/parking", { signal });
export const fetchCounters = (signal?: AbortSignal): Promise<CounterFeed> => api<CounterFeed>("/api/pulse/counters", { signal });
export const fetchRivers = (box: { west: number; south: number; east: number; north: number }, signal?: AbortSignal): Promise<RiverFeed> => api<RiverFeed>(qs("/api/pulse/rivers", box), { signal });

export function useBridges(): Polled<BridgeFeed> {
  return usePoll((signal) => fetchBridges(signal), 120_000, []);
}

export function useParking(): Polled<ParkingFeed> {
  return usePoll((signal) => fetchParking(signal), 60_000, []);
}

export function useCounters(): Polled<CounterFeed> {
  return usePoll((signal) => fetchCounters(signal), 60_000, []);
}

export function useCounterDetail(id: string): Polled<CounterDetail> {
  return usePoll((signal) => api<CounterDetail>(qs("/api/pulse/counter", { id }), { signal }), null, [id]);
}

export function useRivers(view: MapView): Polled<RiverFeed> {
  // A pitched map reports a huge horizon; ask only for the stretch around its centre.
  const box = useMemo(() => clampView(view, 0.55, 0.32), [view]);
  return usePoll((signal) => fetchRivers(box, signal), 300_000, [box.west, box.south, box.east, box.north]);
}

export function useRiverSeries(id: string): Polled<RiverSeries> {
  return usePoll((signal) => api<RiverSeries>(qs("/api/pulse/river", { id }), { signal }), 300_000, [id]);
}

export function useMatrix(view: MapView): Polled<MatrixFeed> {
  const box = useMemo(() => clampView(view, 0.55, 0.32), [view]);
  return usePoll((signal) => api<MatrixFeed>(qs("/api/pulse/matrix", box), { signal }), 120_000, [box.west, box.south, box.east, box.north]);
}

export function useNearest(lat: number | null, lon: number | null): Polled<Nearest> {
  return usePoll((signal) => api<Nearest>(qs("/api/pulse/nearest", { lat, lon }), { signal }), 60_000, [lat, lon], lat === null || lon === null);
}

/** The view, cut down to at most `lon` by `lat` degrees around its centre and rounded to 3 decimals. */
export function clampView(view: MapView, lon: number, lat: number): { west: number; south: number; east: number; north: number } {
  const r = (n: number): number => Math.round(n * 1000) / 1000;
  return {
    west: r(Math.max(view.west, view.center.lon - lon / 2)),
    east: r(Math.min(view.east, view.center.lon + lon / 2)),
    south: r(Math.max(view.south, view.center.lat - lat / 2)),
    north: r(Math.min(view.north, view.center.lat + lat / 2)),
  };
}
