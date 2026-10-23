import { createConnection } from "node:net";

export interface AprsBox { west: number; south: number; east: number; north: number }

/** https://www.aprs-is.net/Connecting.aspx and javAPRSFilter.aspx: login follows identification. */
export function loginLine(callsign: string, box: AprsBox): string {
  if (!/^[A-Za-z0-9]{3,9}(?:-[A-Za-z0-9]{1,2})?$/.test(callsign) || callsign.length > 9 || callsign.endsWith("-0")) {
    throw new Error("Set VANTAGE_APRS_CALLSIGN to your callsign with an optional unique SSID (at most 9 characters, no -0)");
  }
  const areas = box.west <= box.east ? [box] : [{ ...box, east: 180 }, { ...box, west: -180 }];
  const filter = areas.map((b) => `a/${b.north}/${b.west}/${b.south}/${b.east}`).join(" ");
  return `user ${callsign} pass -1 vers VANTAGE 0.1 filter ${filter}\r\n`;
}

/** A bounded, receive-only TCP connection. Cancelling the iterator closes a pending read immediately. */
export function aprsLines(endpoint: { host: string; port: number }, login: string, signal: AbortSignal): AsyncIterable<string> {
  return {
    [Symbol.asyncIterator](): AsyncIterator<string> {
      const queue: string[] = [];
      let rest = "";
      let ended = signal.aborted;
      let failure: Error | null = null;
      let wake: (() => void) | null = null;
      let loggedIn = false;
      const handshake = setTimeout(() => finish(new Error("APRS-IS did not identify and acknowledge the login within 10 seconds")), 10_000);
      const socket = createConnection({ host: endpoint.host, port: endpoint.port });
      const finish = (error?: Error): void => {
        if (ended) return;
        ended = true;
        failure = error ?? null;
        socket.destroy();
        clearTimeout(handshake);
        signal.removeEventListener("abort", abort);
        wake?.();
      };
      const abort = (): void => finish();
      signal.addEventListener("abort", abort, { once: true });
      socket.setEncoding("latin1");
      socket.setTimeout(90_000, () => finish(new Error("APRS-IS sent no packets or keepalive for 90 seconds")));
      socket.on("connect", () => { if (signal.aborted) socket.destroy(); });
      socket.on("data", (chunk: string) => {
        if (ended) return;
        rest += chunk;
        let cut = rest.indexOf("\n");
        while (cut >= 0) {
          const line = rest.slice(0, cut).replace(/\r$/, "");
          rest = rest.slice(cut + 1);
          if (line.length + 2 > 512) return finish(new Error("APRS-IS line exceeds 512 bytes"));
          if (!loggedIn) {
            if (!line.startsWith("#")) return finish(new Error("APRS-IS did not send its server identification"));
            socket.write(login);
            loggedIn = true;
          }
          if (/^#\s*logresp\b/i.test(line)) clearTimeout(handshake);
          if (line) queue.push(line);
          if (queue.length > 256) return finish(new Error("APRS-IS stream exceeded the receive buffer; reconnect to resume"));
          cut = rest.indexOf("\n");
        }
        if (rest.length > 511 || (rest.length === 511 && !rest.endsWith("\r"))) return finish(new Error("APRS-IS line exceeds 512 bytes"));
        wake?.();
      });
      socket.on("error", (error) => finish(error));
      socket.on("close", () => finish(new Error("APRS-IS closed the connection")));
      if (signal.aborted) { clearTimeout(handshake); socket.destroy(); }
      return {
        async next(): Promise<IteratorResult<string>> {
          while (!queue.length && !ended) await new Promise<void>((resolve) => { wake = resolve; });
          wake = null;
          if (failure) throw failure;
          if (ended) return { done: true, value: undefined };
          return { done: false, value: queue.shift()! };
        },
        async return(): Promise<IteratorResult<string>> {
          finish();
          return { done: true, value: undefined };
        },
      };
    },
  };
}
