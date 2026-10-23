import { describe, fetchUpstream, HttpError, log, parseUpstream, z } from "../../server/kit";
import { withoutKey } from "../posts/sources/source.server";

/**
 * Every TomTom request in VANTAGE goes through this module. TomTom bills a key against a daily allowance (on the free
 * plan 50,000 tile requests and 2,500 other requests) and answers 403 InsufficientFunds when it runs out. The allowance
 * goes first to what the screen is missing: an answer nobody has yet comes before refreshing one already on screen, and
 * the newest request comes first, because it belongs to the view the user looks at now. A refresh keeps the old answer
 * on screen until the new one arrives.
 */
export type TomTomKind = "tile" | "call";

interface Budget {
  perDay: number;
  burst: number;
  /** The shortest time between two request starts. TomTom allows five non-tile requests a second. */
  gapMs: number;
}
const BUDGETS: Record<TomTomKind, Budget> = {
  // The burst is how much unused allowance can build up for refreshes.
  tile: { perDay: 50_000, burst: 400, gapMs: 20 },
  call: { perDay: 2_500, burst: 60, gapMs: 250 },
};
/**
 * The bucket holds the allowance left for refreshes. A missing answer only waits for the per-second gap and spends from
 * the bucket, which may go below zero; a refresh waits until the bucket is this full. So missing answers never queue
 * behind the daily allowance, and refreshes use only what they leave over. TomTom's own 403 stops a spent allowance.
 */
const REFRESH_RESERVE = 0.5;
/** A refresh nobody could afford for this long is dropped; the next request for the key queues it again. */
const REFRESH_EXPIRY_MS = 10 * 60_000;
const CREDIT_PAUSE_MS = 15 * 60_000;
const RATE_PAUSE_MS = 10_000;
const MAX_ENTRIES = 2_000;

interface Job {
  kind: TomTomKind;
  refresh: boolean;
  queuedAt: number;
  seq: number;
  start: () => void;
  fail: (err: unknown) => void;
}
interface Lane {
  budget: Budget;
  tokens: number;
  filledAt: number;
  nextStartAt: number;
  pausedUntil: number;
  pause: HttpError | null;
}

const lanes = new Map<TomTomKind, Lane>();
const queue: Job[] = [];
let seq = 0;
let timer: ReturnType<typeof setTimeout> | undefined;

function lane(kind: TomTomKind, now: number): Lane {
  let l = lanes.get(kind);
  if (!l) {
    const budget = BUDGETS[kind];
    l = { budget, tokens: budget.burst, filledAt: now, nextStartAt: 0, pausedUntil: 0, pause: null };
    lanes.set(kind, l);
  }
  const rate = l.budget.perDay / 86_400_000;
  l.tokens = Math.min(l.budget.burst, l.tokens + Math.max(0, now - l.filledAt) * rate);
  l.filledAt = now;
  return l;
}

/** The waiting job to start next: the newest missing answer, else the newest refresh. */
function next(kind: TomTomKind, now: number): Job | undefined {
  let best: Job | undefined;
  for (let i = queue.length - 1; i >= 0; i--) {
    const job = queue[i];
    if (!job || job.kind !== kind) continue;
    if (job.refresh && now - job.queuedAt > REFRESH_EXPIRY_MS) {
      queue.splice(i, 1);
      job.fail(new HttpError(503, "refresh_dropped", "TomTom refresh was dropped to save the request allowance"));
      continue;
    }
    if (!best || (best.refresh && !job.refresh) || (best.refresh === job.refresh && job.seq > best.seq)) best = job;
  }
  return best;
}

function pump(): void {
  clearTimeout(timer);
  timer = undefined;
  const now = Date.now();
  let wait = Infinity;
  for (const kind of Object.keys(BUDGETS) as TomTomKind[]) {
    const l = lane(kind, now);
    const job = next(kind, now);
    if (!job) continue;
    const refillMs = job.refresh ? ((l.budget.burst * REFRESH_RESERVE - l.tokens) * 86_400_000) / l.budget.perDay : 0;
    const at = Math.max(l.nextStartAt, now + Math.max(0, refillMs));
    if (at > now) {
      wait = Math.min(wait, at - now);
      continue;
    }
    l.tokens -= 1;
    l.nextStartAt = now + l.budget.gapMs;
    queue.splice(queue.indexOf(job), 1);
    job.start();
    wait = Math.min(wait, l.budget.gapMs);
  }
  if (wait < Infinity) timer = setTimeout(pump, Math.ceil(wait));
}

/** Resolve when the request may start. A job that waits can be removed with `cancel`. */
function enqueue(kind: TomTomKind, refresh: boolean): { job: Job; ready: Promise<void> } {
  const now = Date.now();
  const l = lane(kind, now);
  let job!: Job;
  const ready = new Promise<void>((resolve, reject) => {
    job = { kind, refresh, queuedAt: now, seq: ++seq, start: resolve, fail: reject };
  });
  if (l.pause && l.pausedUntil > now) job.fail(l.pause);
  else {
    queue.push(job);
    pump();
  }
  return { job, ready };
}

function paused(kind: TomTomKind): boolean {
  return lane(kind, Date.now()).pausedUntil > Date.now();
}

function cancel(job: Job, reason: unknown): void {
  const i = queue.indexOf(job);
  if (i < 0) return;
  queue.splice(i, 1);
  job.fail(reason);
}

function pause(kind: TomTomKind, ms: number, error: HttpError): void {
  const l = lane(kind, Date.now());
  l.pausedUntil = Date.now() + ms;
  l.pause = error;
  for (const job of queue.filter((j) => j.kind === kind)) cancel(job, error);
  log.warn("TomTom paused", { kind, seconds: Math.round(ms / 1000), reason: error.message });
}

const Failure = z.object({
  detailedError: z.object({ code: z.string(), message: z.string() }).optional(),
  errorText: z.string().optional(),
});

/** Fetch from TomTom. A spent allowance or a rate limit pauses that kind of request instead of retrying into it. */
export async function tomtomFetch(kind: TomTomKind, source: string, url: URL, key: string, init: RequestInit = {}): Promise<Response> {
  try {
    const res = await fetchUpstream(source, url, { ...init, redirect: "error", acceptedStatuses: [403, 429] });
    if (res.status !== 403 && res.status !== 429) return res;
    const body = Failure.safeParse(await res.json().catch(() => null));
    const detail = body.success ? body.data.detailedError : undefined;
    const text = detail ? `${detail.code}: ${detail.message}` : body.success ? body.data.errorText : undefined;
    if (detail?.code === "InsufficientFunds") {
      const error = new HttpError(503, "upstream_credits", `${source}: the key has no TomTom credits left for these requests (${detail.message}). VANTAGE waits 15 minutes before it asks again and keeps showing what it already loaded. Check the key's usage at developer.tomtom.com.`);
      pause(kind, CREDIT_PAUSE_MS, withoutKey(error, key));
      throw error;
    }
    if (res.status === 429) {
      const seconds = Number(res.headers.get("retry-after"));
      const error = new HttpError(503, "upstream_rate_limited", `${source} is rate limiting requests. VANTAGE waits before it asks again.`);
      pause(kind, Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : RATE_PAUSE_MS, withoutKey(error, key));
      throw error;
    }
    throw new HttpError(502, "upstream_status", `${source} refused the request (HTTP 403${text ? `, ${text}` : ""}). Check that the TomTom key has access to this API.`);
  } catch (err) {
    throw withoutKey(err, key);
  }
}

export async function tomtomJson<S extends z.ZodType>(source: string, url: URL, schema: S, key: string, init?: RequestInit): Promise<z.infer<S>> {
  const res = await tomtomFetch("call", source, url, key, init);
  const data: unknown = await res.json().catch(() => {
    throw new HttpError(502, "upstream_shape", `${source} sent a response that is not JSON`);
  });
  return parseUpstream(source, schema, data);
}

interface Entry {
  at: number;
  value: unknown;
}
interface Pending {
  promise: Promise<Entry>;
  job: Job;
  waiters: number;
}
const entries = new Map<string, Entry>();
const pending = new Map<string, Pending>();

function keep(key: string, entry: Entry): void {
  entries.delete(key);
  entries.set(key, entry);
  // A Map iterates in insertion order and every hit re-inserts, so the first key is the least recently used.
  if (entries.size > MAX_ENTRIES) entries.delete(entries.keys().next().value ?? key);
}

function start(key: string, kind: TomTomKind, refresh: boolean, load: () => Promise<unknown>): Pending {
  const { job, ready } = enqueue(kind, refresh);
  const promise = ready.then(load).then((value) => {
    const entry = { at: Date.now(), value };
    keep(key, entry);
    return entry;
  });
  const run = { promise, job, waiters: 0 };
  pending.set(key, run);
  const done = (): void => void (pending.get(key) === run && pending.delete(key));
  promise.then(done, done);
  return run;
}

function abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const stop = (): void => reject(signal.reason);
    signal.addEventListener("abort", stop, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", stop));
  });
}

/**
 * The cached answer for `key` and when TomTom gave it. An answer older than `ttlMs` is returned at once while a
 * refresh waits for spare allowance. Without an answer, the caller waits for one; a request whose callers all left
 * (the map scrolled past the tile) leaves the queue before it costs anything. A key must identify one loader.
 */
export async function tomtomCached<T>(key: string, kind: TomTomKind, ttlMs: number, load: () => Promise<T>, signal?: AbortSignal): Promise<{ value: T; at: number }> {
  const hit = entries.get(key);
  if (hit) {
    keep(key, hit);
    if (Date.now() - hit.at >= ttlMs && !pending.has(key) && !paused(kind))
      start(key, kind, true, load).promise.catch((err: unknown) => log.warn("TomTom refresh failed", { key, error: describe(err) }));
    return hit as { value: T; at: number };
  }
  const run = pending.get(key) ?? start(key, kind, false, load);
  run.waiters++;
  try {
    return (await abortable(run.promise, signal)) as { value: T; at: number };
  } finally {
    run.waiters--;
    if (run.waiters === 0 && signal?.aborted) cancel(run.job, signal.reason);
  }
}

/** Forget every answer, queued request and pause. Tests only. */
export function resetTomTom(): void {
  for (const job of queue.splice(0)) job.fail(new Error("reset"));
  entries.clear();
  pending.clear();
  lanes.clear();
  clearTimeout(timer);
}
