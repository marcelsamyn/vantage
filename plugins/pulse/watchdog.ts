import { backoffMs } from "./backoff";

export interface WatchdogOptions {
  /** Tick length: the shortest gap between two REST polls. */
  pollMs: number;
  /** MQTT silence beyond this means the broker may have stopped delivering. */
  silenceMs: number;
  /** While MQTT is silent but REST sees nothing new, check this often. */
  quietCheckMs: number;
  /** Longest wait after repeated REST failures. */
  maxBackoffMs: number;
  /** Oldest history one poll may ask for, however long the gap since the last good poll. */
  maxWindowMs: number;
}

/**
 * Decides when the REST fallback for MQTT may run. At most one poll is in flight, a failing server is retried with
 * growing delays, and a poll only asks for the recent past: after hours of healthy MQTT the first poll must not request
 * hours of history, because the page limit would fill with stale rows.
 */
export class Watchdog {
  private busy = false;
  private failures = 0;
  private retryAt = 0;
  private lastCheck = 0;
  private covered: number;
  private pending = 0;

  constructor(
    now: number,
    private readonly options: WatchdogOptions,
  ) {
    this.covered = now;
  }

  /**
   * Called once per tick. Returns the moment to poll from, or null when no poll should run now.
   * `lastMessageAt` is when MQTT last delivered; `stalled` is set after REST found changes MQTT missed.
   */
  begin(now: number, lastMessageAt: number, stalled: boolean): number | null {
    if (this.busy || now < this.retryAt) return null;
    const silent = now - lastMessageAt > this.options.silenceMs;
    if (!silent && !stalled) {
      // MQTT is delivering, so everything up to its last message is known.
      this.covered = Math.max(this.covered, lastMessageAt);
      return null;
    }
    if (!stalled && now - this.lastCheck < this.options.quietCheckMs) return null;
    this.lastCheck = now;
    this.busy = true;
    this.pending = now;
    return Math.max(this.covered - this.options.pollMs, now - this.options.maxWindowMs);
  }

  succeeded(): void {
    this.busy = false;
    this.failures = 0;
    this.retryAt = 0;
    this.covered = this.pending;
  }

  failed(now: number): void {
    this.busy = false;
    this.failures++;
    this.retryAt = now + backoffMs(this.failures, this.options.pollMs, this.options.maxBackoffMs);
  }
}
