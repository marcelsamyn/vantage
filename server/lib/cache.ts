import { createHash, randomUUID } from "node:crypto";
import { mkdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { log } from "./log";
import { describe } from "./http";

interface Entry {
  at: number;
  value: unknown;
}

interface Kept extends Entry {
  staleMs: number;
}

/** The server runs for days and keys often carry a place or a time, so entries must leave the map on their own. */
const MAX_ENTRIES = 2_000;
/** After a failed load, callers get the stale value or the same error until this much time has passed (or the TTL, if shorter). */
const RETRY_AFTER_MS = 60_000;

const memory = new Map<string, Kept>();
const failures = new Map<string, { at: number; error: unknown }>();
const inflight = new Map<string, Promise<unknown>>();

/** Drop entries past their stale window and failures past their retry pause. Runs every minute. */
export function pruneMemo(now = Date.now()): void {
  for (const [key, entry] of memory) if (now - entry.at > entry.staleMs) memory.delete(key);
  for (const [key, failure] of failures) if (now - failure.at > RETRY_AFTER_MS) failures.delete(key);
}
setInterval(pruneMemo, 60_000).unref();

function keep<T>(store: Map<string, T>, key: string, entry: T): void {
  store.delete(key);
  store.set(key, entry);
  // A Map iterates in insertion order and every hit re-inserts, so the first key is the least recently used.
  if (store.size > MAX_ENTRIES) store.delete(store.keys().next().value ?? key);
}

function usable(entry: Entry, maxAgeMs: number): boolean {
  const age = Date.now() - entry.at;
  return age >= 0 && age < maxAgeMs;
}

/** Both tiers use the source's timestamp, including after restoration or a failed refresh. */
async function cached(key: string, ttlMs: number, load: () => Promise<Entry>, staleMs: number, restore?: () => Promise<Entry | null>): Promise<unknown> {
  const hit = memory.get(key);
  const now = Date.now();
  if (hit && usable(hit, ttlMs)) {
    keep(memory, key, hit);
    return hit.value;
  }

  const failed = failures.get(key);
  if (failed && now - failed.at < Math.min(ttlMs, RETRY_AFTER_MS)) {
    keep(failures, key, failed);
    if (hit && usable(hit, staleMs)) {
      keep(memory, key, hit);
      return hit.value;
    }
    throw failed.error;
  }

  const running = inflight.get(key);
  if (running) return running;

  const task = (async (): Promise<unknown> => {
    let previous: Entry | null | undefined = hit;
    try {
      if (!previous && restore) {
        previous = await restore();
        if (previous && usable(previous, Math.max(ttlMs, staleMs))) {
          keep(memory, key, { ...previous, staleMs: Math.max(staleMs, ttlMs) });
          if (usable(previous, ttlMs)) return previous.value;
        }
      }
      const entry = await load();
      failures.delete(key);
      keep(memory, key, { ...entry, staleMs: Math.max(staleMs, ttlMs) });
      return entry.value;
    } catch (err: unknown) {
      keep(failures, key, { at: Date.now(), error: err });
      if (previous && usable(previous, staleMs)) {
        log.warn("serving stale cache", { key, ageS: Math.round((Date.now() - previous.at) / 1000), error: describe(err) });
        keep(memory, key, { ...previous, staleMs: Math.max(staleMs, ttlMs) });
        return previous.value;
      }
      throw err;
    }
  })().finally(() => inflight.delete(key));
  inflight.set(key, task);
  return task;
}

/**
 * Memoize an async load for `ttlMs`. Concurrent callers share one request.
 * A failed refresh can serve a value less than `staleMs` old (total age, not extra time after the TTL).
 * Failures pause retries for the shorter of the TTL and one minute. A key must identify one loader and value type.
 */
export async function memo<T>(key: string, ttlMs: number, load: () => Promise<T>, staleMs = ttlMs * 10): Promise<T> {
  return await cached(key, ttlMs, async () => {
    const value = await load();
    return { at: Date.now(), value };
  }, staleMs) as T;
}

const CACHE_DIR = join(import.meta.dir, "..", "..", ".cache");

const Stored = z.object({ at: z.number().nonnegative(), value: z.unknown() });

function cachePath(key: string): string {
  // Keep existing unambiguous filenames. The separate hashed namespace avoids punctuation, case and long-name collisions.
  const name = /^[a-z0-9._-]{1,180}$/.test(key) ? key : `~${createHash("sha256").update(key).digest("hex")}`;
  return join(CACHE_DIR, `${name}.json`);
}

/**
 * Read one cache file. Its JSON was written by an earlier run, which may have been an earlier build of VANTAGE,
 * so it is outside data: a file this build cannot use — truncated, or holding a record whose fields have since
 * changed — counts as absent, and the source is read again.
 */
async function storedEntry<T>(path: string, key: string, shape: z.ZodType<T>): Promise<(Entry & { value: T }) | null> {
  const file = Bun.file(path);
  if (!(await file.exists())) return null;
  const entry = Stored.safeParse(await file.json().catch(() => null));
  if (!entry.success || entry.data.at > Date.now()) {
    log.warn("disk cache entry unreadable", { key });
    return null;
  }
  const value = shape.safeParse(entry.data.value);
  if (!value.success) {
    // A field missing from every item of a list is one issue per item; name each field once.
    const fields = new Set(value.error.issues.map((issue) => issue.path.map((part) => (typeof part === "number" ? "*" : String(part))).join(".")));
    log.info("disk cache entry no longer fits, reading the source again", { key, fields: [...fields].join(", ") });
    return null;
  }
  return { at: entry.data.at, value: value.data };
}

async function persist(path: string, key: string, entry: Entry): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await mkdir(CACHE_DIR, { recursive: true });
    await Bun.write(temporary, JSON.stringify(entry));
    // Readers see either the complete previous record or the complete new record, even across server processes.
    await rename(temporary, path);
  } catch (err: unknown) {
    log.warn("disk cache write failed; keeping the loaded value in memory", { key, error: describe(err) });
  } finally {
    await rm(temporary, { force: true }).catch((err: unknown) => {
      log.warn("disk cache temporary file removal failed", { key, error: describe(err) });
    });
  }
}

/**
 * Like `memo`, but persists to `.cache/` so large, slow-changing files survive restarts.
 * `shape` validates records from earlier builds. Restored and stale values keep their original timestamps.
 * Disk failures are logged without discarding a successful source response.
 */
export async function diskMemo<T>(key: string, ttlMs: number, load: () => Promise<T>, shape: z.ZodType<T>, staleMs = ttlMs * 10): Promise<T> {
  const path = cachePath(key);
  return await cached(
    `disk:${key}`,
    ttlMs,
    async () => {
      const value = await load();
      const entry = { at: Date.now(), value } satisfies Entry;
      await persist(path, key, entry);
      return entry;
    },
    staleMs,
    () => storedEntry(path, key, shape),
  ) as T;
}
