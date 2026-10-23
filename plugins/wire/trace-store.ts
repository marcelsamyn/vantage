import { create } from "zustand";
import { errorMessage } from "../../app/core/api";
import { sfx } from "../../app/core/sound";
import { resolveOrigin, type Origin } from "./client";
import type { TraceEvent, TraceHop } from "./types";

export type TraceStatus = "idle" | "running" | "done" | "stopped" | "failed";

interface TraceStore {
  host: string;
  /** The address the host name resolved to. */
  ip: string | null;
  origin: Origin | null;
  hops: TraceHop[];
  status: TraceStatus;
  reached: boolean;
  /** Why the run failed, or why some locations are missing. */
  error: string | null;
  geoNote: string | null;
  start: (host: string) => void;
  cancel: () => void;
}

let controller: AbortController | null = null;

const idle = (): Pick<TraceStore, "ip" | "hops" | "reached" | "error" | "geoNote"> => ({ ip: null, hops: [], reached: false, error: null, geoNote: null });

/** The last route you traced. It lives here, not in the screen, so the map layer can draw it and a run survives switching screens. */
export const useTrace = create<TraceStore>((set, get) => ({
  host: "1.1.1.1",
  origin: null,
  status: "idle",
  ...idle(),

  start: (host) => {
    controller?.abort();
    const mine = new AbortController();
    controller = mine;
    set({ host, status: "running", ...idle() });
    void resolveOrigin().then((origin) => {
      if (controller === mine) set({ origin });
    });

    const apply = (event: TraceEvent): void => {
      if ("error" in event) set({ status: "failed", error: event.error.message });
      else if ("trace" in event) set({ ip: event.trace.ip });
      else if ("done" in event) {
        set({ status: "done", reached: event.reached, geoNote: event.geoNote });
        if (event.reached) sfx.lock();
      } else if ("ip" in event) set({ hops: [...get().hops, event] });
      else set({ hops: get().hops.map((h) => (h.hop === event.hop ? { ...h, geo: event.geo } : h)) });
    };

    void (async () => {
      try {
        const res = await fetch(`/api/wire/trace?host=${encodeURIComponent(host)}`, { signal: mine.signal });
        if (!res.ok || !res.body) {
          const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
          throw new Error(body?.error?.message ?? `The trace failed with HTTP ${res.status}.`);
        }
        const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
        let buffer = "";
        try {
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += value;
            let nl = buffer.indexOf("\n");
            while (nl >= 0) {
              const line = buffer.slice(0, nl).trim();
              buffer = buffer.slice(nl + 1);
              if (line) apply(JSON.parse(line) as TraceEvent);
              nl = buffer.indexOf("\n");
            }
          }
        } finally {
          // Cancelling closes the connection, which stops the traceroute on the server when parsing fails or the run ends early.
          void reader.cancel().catch(() => undefined);
        }
        if (get().status === "running") set({ status: "failed", error: "The connection to VANTAGE closed before the trace finished." });
      } catch (err) {
        if (mine.signal.aborted) return;
        set({ status: "failed", error: errorMessage(err) });
      }
    })();
  },

  cancel: () => {
    controller?.abort();
    controller = null;
    if (get().status === "running") set({ status: "stopped" });
  },
}));
