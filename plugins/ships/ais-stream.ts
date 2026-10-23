import { AisDecoder, type AisPosition, type AisStatic } from "./ais-decoder";

/**
 * A connection to a raw AIS feed (NMEA sentences over TCP) that exists only while someone is looking at ships.
 * It keeps the latest position and static data per vessel in memory. `want()` is called on every request for ships:
 * the socket opens on the first call and closes when no call has come for `idleCloseMs`.
 */

export type StreamState = "idle" | "connecting" | "connected" | "unreachable";

export interface StreamOptions {
  host: string;
  port: number;
  /** Close the socket when nobody has asked for ships for this long. */
  idleCloseMs?: number;
  /** Forget vessels not heard from for this long. */
  staleMs?: number;
  /** Wait before the nth reconnect attempt; the last entry repeats. */
  retryMs?: number[];
  /** Give up on a connection attempt that gets no answer after this long. */
  connectTimeoutMs?: number;
  /** Housekeeping interval for idle close and forgetting stale vessels. */
  tickMs?: number;
  onProblem?: (message: string) => void;
}

export interface TrackedVessel {
  position: AisPosition;
  /** When the position arrived, epoch ms. */
  at: number;
  info: Omit<AisStatic, "kind" | "mmsi">;
}

export class AisStream {
  private readonly idleCloseMs: number;
  private readonly staleMs: number;
  private readonly retryMs: number[];
  private readonly decoder = new AisDecoder();
  private readonly positions = new Map<number, { position: AisPosition; at: number }>();
  private readonly statics = new Map<number, Omit<AisStatic, "kind" | "mmsi">>();
  private socket: { end: () => void } | null = null;
  private wantedAt = 0;
  private attempts = 0;
  private generation = 0;
  private readonly connectTimeoutMs: number;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly timer: ReturnType<typeof setInterval>;
  private buffer = "";
  private lastError: string | null = null;
  state: StreamState = "idle";

  constructor(private readonly options: StreamOptions) {
    this.idleCloseMs = options.idleCloseMs ?? 120_000;
    this.staleMs = options.staleMs ?? 30 * 60_000;
    this.retryMs = options.retryMs ?? [5_000, 15_000, 60_000];
    this.connectTimeoutMs = options.connectTimeoutMs ?? 10_000;
    this.timer = setInterval(() => this.tick(), options.tickMs ?? 5_000);
    this.timer.unref();
  }

  /** Someone asked for ships right now. Opens the connection when it is closed. */
  want(): void {
    this.wantedAt = Date.now();
    if (this.state === "idle" || (this.state === "unreachable" && !this.retryTimer)) this.connect();
  }

  get error(): string | null {
    return this.lastError;
  }

  get count(): number {
    return this.positions.size;
  }

  /** Vessels whose latest position lies inside the box (west > east means the box crosses the date line). */
  within(box: { west: number; south: number; east: number; north: number }): TrackedVessel[] {
    const out: TrackedVessel[] = [];
    for (const [mmsi, { position, at }] of this.positions) {
      const inLon = box.west <= box.east ? position.lon >= box.west && position.lon <= box.east : position.lon >= box.west || position.lon <= box.east;
      if (inLon && position.lat >= box.south && position.lat <= box.north) out.push({ position, at, info: this.statics.get(mmsi) ?? {} });
    }
    return out;
  }

  find(mmsi: number): TrackedVessel | null {
    const p = this.positions.get(mmsi);
    return p ? { position: p.position, at: p.at, info: this.statics.get(mmsi) ?? {} } : null;
  }

  staticOf(mmsi: number): Omit<AisStatic, "kind" | "mmsi"> | null {
    return this.statics.get(mmsi) ?? null;
  }

  close(): void {
    this.generation++;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.socket?.end();
    this.socket = null;
    this.state = "idle";
  }

  /** Stop everything, including the housekeeping timer. For tests and shutdown. */
  dispose(): void {
    this.close();
    clearInterval(this.timer);
  }

  private connect(): void {
    // Each attempt has a number. Once a newer attempt starts or the stream closes, events of an older one are ignored.
    const mine = ++this.generation;
    const current = (): boolean => mine === this.generation;
    this.state = "connecting";
    this.buffer = "";
    let failed = false;
    const failOnce = (message: string): void => {
      clearTimeout(giveUp);
      if (!current() || failed) return;
      failed = true;
      this.fail(message);
    };
    // A server that silently drops the connection request would otherwise leave the state at "connecting" for minutes.
    const giveUp = setTimeout(() => {
      if (current() && this.state === "connecting") {
        failOnce(`No answer from ${this.options.host}:${this.options.port} within ${Math.round(this.connectTimeoutMs / 1000)} s`);
        this.generation++;
      }
    }, this.connectTimeoutMs);
    giveUp.unref?.();
    void Bun.connect({
      hostname: this.options.host,
      port: this.options.port,
      socket: {
        open: (socket) => {
          clearTimeout(giveUp);
          if (!current()) {
            socket.end();
            return;
          }
          this.socket = socket;
          this.state = "connected";
          this.attempts = 0;
          this.lastError = null;
        },
        data: (_socket, data) => {
          if (current()) this.receive(data);
        },
        close: () => {
          if (!current()) return;
          this.socket = null;
          failOnce("The connection closed");
        },
        error: (_socket, err) => {
          if (!current()) return;
          this.socket = null;
          failOnce(err.message);
        },
        connectError: (_socket, err) => failOnce(err.message),
      },
    }).catch((err: unknown) => failOnce(err instanceof Error ? err.message : String(err)));
  }

  private fail(message: string): void {
    this.lastError = message;
    this.options.onProblem?.(message);
    this.state = "unreachable";
    // Reconnect only while someone is still looking.
    if (this.retryTimer) return;
    const wait = this.retryMs[Math.min(this.attempts, this.retryMs.length - 1)] ?? 60_000;
    this.attempts++;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (Date.now() - this.wantedAt < this.idleCloseMs) this.connect();
      else this.state = "idle";
    }, wait);
    this.retryTimer.unref?.();
  }

  private receive(data: Uint8Array): void {
    this.buffer += new TextDecoder().decode(data);
    let newline = this.buffer.indexOf("\n");
    const now = Date.now();
    while (newline >= 0) {
      const line = this.buffer.slice(0, newline);
      this.buffer = this.buffer.slice(newline + 1);
      for (const m of this.decoder.push(line)) {
        if (m.kind === "position") this.positions.set(m.mmsi, { position: m, at: now });
        else {
          const { kind: _kind, mmsi, ...rest } = m;
          const held = this.statics.get(mmsi) ?? {};
          // Part A and part B of a class B vessel, and repeated type 5 messages, each add to what is known.
          this.statics.set(mmsi, { ...held, ...Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined)) });
        }
      }
      newline = this.buffer.indexOf("\n");
    }
    // A broken sender could stream bytes without a newline.
    if (this.buffer.length > 4096) this.buffer = "";
  }

  private tick(): void {
    const now = Date.now();
    if (this.state !== "idle" && now - this.wantedAt > this.idleCloseMs) this.close();
    for (const [mmsi, { at }] of this.positions) {
      if (now - at > this.staleMs) {
        this.positions.delete(mmsi);
        this.statics.delete(mmsi);
      }
    }
  }
}
