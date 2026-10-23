import { useEffect, useMemo, useRef, useState } from "react";
import { create } from "zustand";
import { ApiError, qs } from "../../app/core/api";
import { useDocumentVisible, useInterval, useScreenActive } from "../../app/core/hooks";
import type { MapView } from "../city/extension";
import { readNdjson } from "../pulse/client";
import { pruneStations, trackPacket } from "./tracker";
import { geographicBox } from "./view";
import type { AprsEvent, AprsStation } from "./types";

export const useAprsStations = create<{ stations: Map<string, AprsStation> }>(() => ({ stations: new Map() }));

export interface AprsStatus {
  state: "paused" | "connecting" | "live" | "error";
  message: string | null;
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const finish = (): void => { clearTimeout(timer); signal.removeEventListener("abort", finish); resolve(); };
    const timer = setTimeout(finish, ms);
    signal.addEventListener("abort", finish, { once: true });
  });
}

/** Stream only while the map layer's screen and browser tab are visible. */
export function useAprsStream(view: MapView): AprsStatus {
  const visible = useDocumentVisible();
  const active = useScreenActive();
  const run = visible && active;
  const expire = useRef<() => void>(() => undefined);
  useInterval(() => expire.current(), run ? 30_000 : null);
  const path = useMemo(() => qs("/api/aprs/stream", { ...geographicBox(view) }), [view.west, view.south, view.east, view.north]);
  const [status, setStatus] = useState<AprsStatus>({ state: "paused", message: null });
  useEffect(() => {
    if (!run) { setStatus({ state: "paused", message: null }); return; }
    const controller = new AbortController();
    const { signal } = controller;
    let flushTimer: ReturnType<typeof setTimeout> | undefined;
    const stations = new Map(useAprsStations.getState().stations);
    const publish = (): void => {
      flushTimer = undefined;
      if (!signal.aborted) useAprsStations.setState({ stations: new Map(stations) });
    };
    const flush = (): void => { flushTimer ??= setTimeout(publish, 250); };
    pruneStations(stations, Date.now());
    publish();
    expire.current = () => { const count = stations.size; pruneStations(stations, Date.now()); if (stations.size !== count) flush(); };
    void (async () => {
      let failures = 0;
      while (!signal.aborted) {
        setStatus({ state: "connecting", message: "Connecting to APRS-IS" });
        const openedAt = Date.now();
        try {
          await readNdjson<AprsEvent>(path, signal, (event) => {
            if (signal.aborted) return;
            if (event.t === "status") setStatus({ state: event.live ? "live" : "connecting", message: event.message });
            else {
              failures = 0;
              setStatus((s) => s.state === "live" ? s : { state: "live", message: null });
              trackPacket(stations, event.packet);
              flush();
            }
          });
          if (!signal.aborted) setStatus({ state: "error", message: "APRS-IS ended the stream. Reconnecting…" });
        } catch (error) {
          if (signal.aborted) return;
          setStatus({ state: "error", message: error instanceof Error ? error.message : String(error) });
          if (error instanceof ApiError && [400, 503].includes(error.status)) return;
        }
        if (signal.aborted) return;
        failures = Date.now() - openedAt >= 30_000 ? 1 : failures + 1;
        await delay(Math.min(30_000, 2000 * 2 ** Math.min(failures - 1, 4)), signal);
      }
    })();
    return () => { controller.abort(); clearTimeout(flushTimer); expire.current = () => undefined; };
  }, [run, path]);
  return status;
}
