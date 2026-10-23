import { HttpError, describe, fetchUpstream } from "../../server/kit";
import type { SpeedProgress, SpeedResult } from "./types";

/**
 * Speed test against Cloudflare's public speed endpoints, run from this server so browser connection limits do
 * not matter. Latency first, then download, then upload. Progress events carry live Mbps for the gauge.
 */

const BASE = "https://speed.cloudflare.com";
const SOURCE = "Cloudflare speed test";
const PING_SAMPLES = 20;
const STEP_BUDGET_MS = 8_000;
const TICK_MS = 120;
/** The live gauge shows the rate over this window, so it follows the link instead of the running average. */
const LIVE_WINDOW_MS = 600;

/** Escalating payloads. Parallel streams fill a fast link that a single TCP stream cannot. */
const DOWNLOAD_STEPS = [
  { bytes: 100_000, streams: 1 },
  { bytes: 1_000_000, streams: 2 },
  { bytes: 10_000_000, streams: 3 },
  { bytes: 25_000_000, streams: 3 },
];
const UPLOAD_STEPS = [
  { bytes: 1_000_000, streams: 2 },
  { bytes: 5_000_000, streams: 3 },
  { bytes: 10_000_000, streams: 3 },
];

interface Lease {
  abort: AbortController;
  /** Last time the browser pulled an event. */
  beat: number;
}

/** The test in progress. Only one runs at a time so two tests never compete for the same bandwidth. */
let current: Lease | null = null;

/**
 * A browser that disappears mid-test (reload, closed tab) can leave its generator parked at a `yield` without the
 * server being told. A test that nobody has pulled from for this long is abandoned and its successor takes over.
 */
const ABANDONED_MS = 20_000;

/** fetchUpstream only applies its own timeout when no signal is given, so the deadline is joined to the abort signal here. */
const within = (ms: number, signal: AbortSignal): AbortSignal => AbortSignal.any([signal, AbortSignal.timeout(ms)]);

const toMbps = (bytes: number, ms: number): number => (ms > 0 ? (bytes * 8) / (ms / 1000) / 1e6 : 0);

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? (s[mid] ?? 0) : ((s[mid - 1] ?? 0) + (s[mid] ?? 0)) / 2;
}

/** Median round-trip time, and jitter as the mean difference between consecutive samples. */
export function summarizePings(samples: number[]): { pingMs: number; jitterMs: number } {
  const diffs = samples.slice(1).map((v, i) => Math.abs(v - (samples[i] ?? v)));
  return { pingMs: median(samples), jitterMs: diffs.length ? diffs.reduce((a, b) => a + b, 0) / diffs.length : 0 };
}

/** Data centre code from the `colo` header, or the cf-ray suffix ("…-MXP"). */
function coloOf(res: Response): string | null {
  return res.headers.get("cf-meta-colo") ?? res.headers.get("colo") ?? res.headers.get("cf-ray")?.split("-")[1] ?? null;
}

async function download(bytes: number, signal: AbortSignal, count: (n: number) => void): Promise<void> {
  const res = await fetchUpstream(SOURCE, `${BASE}/__down?bytes=${bytes}`, { signal: within(60_000, signal), timeoutMs: 60_000, headers: { accept: "*/*" } });
  if (!res.body) throw new HttpError(502, "upstream_shape", `${SOURCE} sent no data`);
  for await (const chunk of res.body) count(chunk.byteLength);
}

const UPLOAD_CHUNK = 16_384;

/**
 * fetch reports no upload progress, so the body is a stream that counts each chunk as the network takes it.
 * Socket buffers let this run slightly ahead of the wire; the step's final rate uses the request's total time.
 */
async function upload(bytes: number, signal: AbortSignal, count: (n: number) => void): Promise<void> {
  let sent = 0;
  const body = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        if (sent >= bytes) return controller.close();
        const n = Math.min(UPLOAD_CHUNK, bytes - sent);
        sent += n;
        count(n);
        controller.enqueue(new Uint8Array(n));
      },
    },
    { highWaterMark: 0 },
  );
  // Streaming request bodies need `duplex`, which the DOM RequestInit type does not list.
  const init: RequestInit & { duplex: "half"; timeoutMs: number } = { method: "POST", body, duplex: "half", signal: within(60_000, signal), timeoutMs: 60_000, headers: { "content-type": "application/octet-stream" } };
  const res = await fetchUpstream(SOURCE, `${BASE}/__up`, init);
  await res.arrayBuffer();
}

interface Sample {
  /** Rate over the live window while the step runs; the step's average when it is done. */
  mbps: number;
  /** Fraction of the step's bytes moved so far, 0 to 1. */
  fraction: number;
  done: boolean;
}

/** Run one step's parallel streams and yield a sample every tick, then a final one. */
async function* measureStep(launch: (count: (n: number) => void) => Promise<void>[], totalBytes: number, clockFromFirstByte: boolean): AsyncGenerator<Sample> {
  const begin = performance.now();
  let moved = 0;
  let firstAt = 0;
  let endedAt = 0;
  let failure: unknown = null;
  const history: { at: number; bytes: number }[] = [];

  const count = (n: number): void => {
    firstAt ||= performance.now();
    moved += n;
  };
  const all = Promise.all(launch(count))
    .then(() => undefined)
    .catch((err: unknown) => {
      failure = err;
    })
    .finally(() => {
      endedAt = performance.now();
    });

  while (!endedAt) {
    await Bun.sleep(TICK_MS);
    if (endedAt) break;
    const now = performance.now();
    history.push({ at: now, bytes: moved });
    const from = history.find((h) => now - h.at <= LIVE_WINDOW_MS) ?? history[0];
    const start = clockFromFirstByte ? firstAt : begin;
    const rate = from && now > from.at ? toMbps(moved - from.bytes, now - from.at) : toMbps(moved, now - (start || begin));
    if (moved > 0) yield { mbps: rate, fraction: Math.min(0.97, moved / totalBytes), done: false };
  }
  await all;
  if (failure) throw failure;
  yield { mbps: toMbps(totalBytes, endedAt - (clockFromFirstByte ? firstAt || begin : begin)), fraction: 1, done: true };
}

/** The three phases as a stream of events. Stops early when `signal` aborts. */
async function* measure(signal: AbortSignal): AsyncGenerator<SpeedProgress | SpeedResult> {
  // ── Latency ──
  const samples: number[] = [];
  let colo: string | null = null;
  for (let i = 0; i <= PING_SAMPLES; i++) {
    const t0 = performance.now();
    const res = await fetchUpstream(SOURCE, `${BASE}/__down?bytes=0`, { signal: within(5_000, signal), timeoutMs: 5_000, headers: { "cache-control": "no-cache" } });
    await res.arrayBuffer();
    const rtt = performance.now() - t0;
    colo ??= coloOf(res);
    // The first request pays for DNS and the TLS handshake, so it only warms the connection.
    if (i === 0) continue;
    samples.push(rtt);
    yield { type: "progress", phase: "ping", progress: i / PING_SAMPLES, mbps: 0, pingMs: median(samples) };
  }
  const { pingMs, jitterMs } = summarizePings(samples);

  // ── Download ──
  let downMbps = 0;
  for (const [index, step] of DOWNLOAD_STEPS.entries()) {
    const started = performance.now();
    const launch = (count: (n: number) => void): Promise<void>[] => Array.from({ length: step.streams }, () => download(step.bytes, signal, count));
    for await (const s of measureStep(launch, step.bytes * step.streams, true)) {
      yield { type: "progress", phase: "download", progress: (index + s.fraction) / DOWNLOAD_STEPS.length, mbps: s.mbps };
      // Steps under 1 MB end inside TCP slow start and understate the link.
      if (s.done && step.bytes >= 1_000_000) downMbps = Math.max(downMbps, s.mbps);
    }
    if (performance.now() - started > STEP_BUDGET_MS) break;
  }

  // ── Upload ──
  let upMbps = 0;
  for (const [index, step] of UPLOAD_STEPS.entries()) {
    const started = performance.now();
    const launch = (count: (n: number) => void): Promise<void>[] => Array.from({ length: step.streams }, () => upload(step.bytes, signal, count));
    for await (const s of measureStep(launch, step.bytes * step.streams, false)) {
      yield { type: "progress", phase: "upload", progress: (index + s.fraction) / UPLOAD_STEPS.length, mbps: s.mbps };
      if (s.done) upMbps = Math.max(upMbps, s.mbps);
    }
    if (performance.now() - started > STEP_BUDGET_MS) break;
  }

  yield { type: "result", downMbps, upMbps, pingMs, jitterMs, colo, at: Date.now() };
}

export async function* runSpeedTest(): AsyncGenerator<SpeedProgress | SpeedResult> {
  if (current && Date.now() - current.beat < ABANDONED_MS) throw new HttpError(409, "speed_test_running", "A speed test is already running. Wait for it to finish.");
  current?.abort.abort();
  const lease: Lease = { abort: new AbortController(), beat: Date.now() };
  current = lease;
  try {
    for await (const event of measure(lease.abort.signal)) {
      lease.beat = Date.now();
      yield event;
      // Reaching this line means the browser asked for the next event, so it is still listening.
      lease.beat = Date.now();
    }
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw new HttpError(502, "speed_test_failed", `The speed test stopped: ${describe(err)}`);
  } finally {
    // Aborting on exit cancels in-flight requests when the browser stops listening.
    lease.abort.abort();
    if (current === lease) current = null;
  }
}
