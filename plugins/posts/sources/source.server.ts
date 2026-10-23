import { HttpError, describe, fetchJson, type z } from "../../../server/kit";
import type { Box, PostOf, PostSourceId } from "../types";

/** Sent to every source; iNaturalist and the YouTube and Flickr terms ask apps to identify themselves. */
export const HEADERS = { "user-agent": "VANTAGE/1.0 (personal dashboard; local)" };

export interface LoadOptions {
  /** BCP 47 language tag of the viewer, e.g. "it-IT", for names in their language. */
  locale: string;
  now: number;
  /** The oldest cached answer the caller accepts. Only sources that pay per request (YouTube) honour it. */
  maxAgeMs?: number;
}

/**
 * One source of posts. Adding a source means one new module that exports one of these, plus one entry in
 * `sources/index.server.ts`. Each module caches its raw upstream replies and derives posts on every call, so a change
 * to the derivation applies at once.
 */
export interface PostSource<S extends PostSourceId = PostSourceId> {
  id: S;
  label: string;
  /** Where the source has posts; null means worldwide. Areas outside it are answered without a request. */
  area: Box | null;
  /** False for an optional source whose free key is not set. */
  configured: () => boolean;
  /** Posts in the area (already rounded to the grid), newest first. */
  posts: (box: Box, options: LoadOptions) => Promise<{ posts: PostOf<S>[]; capped: boolean }>;
}

/**
 * A sliding one-minute window that refuses requests above `perMinute`. Sources ask for fair use, and the cache
 * absorbs repeat views, so hitting the cap means something is asking far too often.
 */
export function rateGate(source: string, perMinute: number, clock: () => number = Date.now): () => void {
  const stamps: number[] = [];
  return () => {
    const now = clock();
    while (stamps.length && now - (stamps[0] ?? now) >= 60_000) stamps.shift();
    if (stamps.length >= perMinute) throw new HttpError(503, "rate_capped", `VANTAGE keeps ${source} to ${perMinute} requests a minute. Try again in a minute.`);
    stamps.push(now);
  };
}

// ── Optional keys ─────────────────────────────────────────────────

export const KEY_NAMES = { youtube: "VANTAGE_YOUTUBE_KEY", flickr: "VANTAGE_FLICKR_KEY" } as const;

/** The key from the server's environment (Bun reads `.env`), or null. Keys stay on the server. */
export function readKey(source: keyof typeof KEY_NAMES): string | null {
  const value = process.env[KEY_NAMES[source]]?.trim();
  return value ? value : null;
}

export const NEEDS_KEY = "Needs a free key: see README";

/** Replace every spelling of the key in a text, plain or URL-encoded, so no message can carry it. */
export function redact(text: string, key: string): string {
  let out = text;
  // As typed, as encodeURIComponent writes it, and as URLSearchParams writes it in a query string.
  const forms = new Set([key, encodeURIComponent(key), new URLSearchParams({ k: key }).toString().slice(2)]);
  for (const form of forms) out = out.split(form).join("[key]");
  return out;
}

/** An error safe to log and to send to the browser: its message cannot carry the key. */
export function withoutKey(err: unknown, key: string): HttpError {
  if (err instanceof HttpError) return new HttpError(err.status, err.code, redact(err.message, key));
  return new HttpError(502, "upstream_failed", redact(describe(err), key));
}

/** `fetchJson` for a request that carries a key: any failure is rethrown with the key removed from its message. */
export async function fetchKeyed<S extends z.ZodType>(source: string, url: URL, schema: S, key: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<z.infer<S>> {
  try {
    return await fetchJson(source, url, schema, init);
  } catch (err) {
    throw withoutKey(err, key);
  }
}
