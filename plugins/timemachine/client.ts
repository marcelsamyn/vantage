import { useCallback, useEffect, useState } from "react";
import { api, errorMessage, qs } from "../../app/core/api";
import type { LatLon } from "../../shared/geo";
import type { Era, ErasPayload } from "./types";

/** The eras that have a picture at a place, oldest first. */
export function fetchEras(at: LatLon, signal?: AbortSignal): Promise<ErasPayload> {
  return api<ErasPayload>(qs("/api/timemachine/eras", { lat: at.lat.toFixed(5), lon: at.lon.toFixed(5) }), { signal });
}

export interface ErasState {
  eras: Era[];
  unreachable: string[];
  loading: boolean;
  /** True once the lookup for the current place has finished, whether it worked or not. */
  settled: boolean;
  error: string | null;
  retry: () => void;
}

/** About 2 km: panning inside one cell reuses the answer. The server checks coverage on a similar grid. */
const CELL_DEG = 0.02;

interface Loaded {
  eras: Era[];
  unreachable: string[];
  loading: boolean;
  settled: boolean;
  error: string | null;
}

const IDLE: Loaded = { eras: [], unreachable: [], loading: false, settled: false, error: null };

/**
 * The eras for a place that moves. Looks up again only when the place crosses into a new cell, waits for the
 * map to settle, and keeps the previous list on screen while the next one loads so the control does not flash.
 */
export function useEras(at: LatLon | null, settleMs = 400): ErasState {
  const [state, setState] = useState<Loaded>(IDLE);
  const [attempt, setAttempt] = useState(0);
  const cell = at ? `${Math.round(at.lat / CELL_DEG)}:${Math.round(at.lon / CELL_DEG)}` : null;

  useEffect(() => {
    if (!at) return;
    const controller = new AbortController();
    setState((s) => ({ ...s, settled: false }));
    const timer = setTimeout(() => {
      setState((s) => ({ ...s, loading: true, error: null }));
      fetchEras(at, controller.signal)
        .then((payload) => setState({ eras: payload.eras, unreachable: payload.unreachable, loading: false, settled: true, error: null }))
        .catch((err: unknown) => {
          if (err instanceof DOMException && err.name === "AbortError") return;
          setState((s) => ({ ...s, loading: false, settled: true, error: errorMessage(err) }));
        });
    }, settleMs);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
    // `cell` is the dependency on purpose: `at` changes on every pan.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cell, attempt, settleMs]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { ...state, retry };
}
