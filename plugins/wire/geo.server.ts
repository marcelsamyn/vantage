import { HttpError, fetchJson, log, z } from "../../server/kit";
import type { HostGeo } from "./types";

/** GeoJS: HTTPS, no key, comma-separated batches. */
const ENDPOINT = "https://get.geojs.io/v1/ip/geo.json";
const BATCH_SIZE = 50;
/** Requests are spaced at least this far apart, to stay polite to a free service. */
const SPACING_MS = 1000;
const TTL_MS = 24 * 3_600_000;
/** Callers that arrive within this window share one request, so a trace does not spend one request per hop. */
const WINDOW_MS = 500;

/** Coordinates are strings, and "nil" when GeoJS has no position for the address. */
const Answer = z.array(
  z.object({
    ip: z.string(),
    country: z.string().optional(),
    country_code: z.string().optional(),
    city: z.string().optional(),
    latitude: z.string().optional(),
    longitude: z.string().optional(),
    organization_name: z.string().optional(),
    organization: z.string().optional(),
  }),
);

const blankToNull = (s: string | undefined): string | null => (s ? s : null);

function coordinate(text: string | undefined): number | null {
  const n = text === undefined || text === "nil" || text.trim() === "" ? NaN : Number(text);
  return Number.isFinite(n) ? n : null;
}

function toGeo(item: z.infer<typeof Answer>[number]): HostGeo | null {
  const lat = coordinate(item.latitude);
  const lon = coordinate(item.longitude);
  if (lat === null || lon === null || !item.country_code) return null;
  return {
    country: item.country ?? item.country_code,
    countryCode: item.country_code,
    city: blankToNull(item.city),
    lat,
    lon,
    isp: blankToNull(item.organization_name),
    org: blankToNull(item.organization_name),
    as: blankToNull(item.organization),
  };
}

const MAX_CACHED = 5000;
const cache = new Map<string, { at: number; geo: HostGeo | null }>();
let lastRequestAt = 0;
let pausedUntil = 0;
let problem: string | null = null;

let queue = new Set<string>();
let waiting: (() => void)[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;

const isFresh = (ip: string): boolean => {
  const hit = cache.get(ip);
  return hit !== undefined && Date.now() - hit.at < TTL_MS;
};

/** Drops expired entries, then the oldest ones, so a long session does not keep one entry per address it ever saw. */
function remember(ip: string, geo: HostGeo | null): void {
  const now = Date.now();
  for (const [key, hit] of cache) if (now - hit.at >= TTL_MS) cache.delete(key);
  for (const key of cache.keys()) {
    if (cache.size < MAX_CACHED) break;
    cache.delete(key);
  }
  cache.set(ip, { at: now, geo });
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export interface GeoResult {
  /** Addresses that were located, or that GeoJS has no location for (null). Others are missing. */
  geo: Map<string, HostGeo | null>;
  /** Why some addresses are missing, or null. */
  problem: string | null;
}

function collect(ips: readonly string[]): GeoResult {
  const geo = new Map<string, HostGeo | null>();
  for (const ip of ips) if (isFresh(ip)) geo.set(ip, cache.get(ip)?.geo ?? null);
  return { geo, problem: geo.size < new Set(ips).size ? problem : null };
}

/** Locate public addresses. Answers come from a 24 h cache, new ones from batched requests spaced one second apart. */
export function geolocate(ips: readonly string[]): Promise<GeoResult> {
  const missing = ips.filter((ip) => !isFresh(ip));
  if (missing.length === 0) return Promise.resolve(collect(ips));
  for (const ip of missing) queue.add(ip);
  return new Promise((resolve) => {
    waiting.push(() => resolve(collect(ips)));
    timer ??= setTimeout(() => void flush(), WINDOW_MS);
  });
}

async function flush(): Promise<void> {
  timer = null;
  const ips = [...queue];
  queue = new Set();
  const done = waiting;
  waiting = [];
  try {
    for (let i = 0; i < ips.length; i += BATCH_SIZE) {
      if (!(await lookupBatch(ips.slice(i, i + BATCH_SIZE)))) break;
    }
  } finally {
    for (const resolve of done) resolve();
  }
}

/** Returns false when the batch could not be fetched, so the caller stops asking. */
async function lookupBatch(ips: string[]): Promise<boolean> {
  const pause = pausedUntil - Date.now();
  if (pause > 0) {
    problem = `GeoJS asked for a pause. More locations will appear in about ${Math.ceil(pause / 1000)} s.`;
    return false;
  }
  const wait = lastRequestAt + SPACING_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastRequestAt = Date.now();
  try {
    const answer = await fetchJson("GeoJS", `${ENDPOINT}?ip=${ips.map(encodeURIComponent).join(",")}`, Answer, { timeoutMs: 8000 });
    const byIp = new Map(answer.map((item) => [item.ip.toLowerCase(), item]));
    ips.forEach((ip, i) => {
      // Match by address; fall back to position when GeoJS spells an IPv6 address differently.
      const item = byIp.get(ip.toLowerCase()) ?? (answer.length === ips.length ? answer[i] : undefined);
      if (item) remember(ip, toGeo(item));
    });
    problem = null;
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (err instanceof HttpError && err.code === "upstream_rate_limited") pausedUntil = Date.now() + 60_000;
    problem = `Locations are unavailable: ${message}`;
    log.warn("ip location lookup failed", { error: message, addresses: ips.length });
    return false;
  }
}
