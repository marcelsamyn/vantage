import { reverse } from "node:dns/promises";

const FOUND_MS = 3_600_000;
const TIMEOUT_MS = 1000;
/** A slow resolver is retried soon; a name that does not exist is not. */
const RETRY_MS = 120_000;

interface Entry {
  at: number;
  ttl: number;
  name: string | null;
}
const MAX_CACHED = 5000;
const cache = new Map<string, Entry>();

/** Drops expired entries, then the oldest ones, so a long session does not keep one entry per address it ever saw. */
function remember(ip: string, entry: Entry): void {
  for (const [key, hit] of cache) if (entry.at - hit.at >= hit.ttl) cache.delete(key);
  for (const key of cache.keys()) {
    if (cache.size < MAX_CACHED) break;
    cache.delete(key);
  }
  cache.set(ip, entry);
}

/** Reverse DNS with a 1 s timeout. Most addresses have no published name, so null is a normal answer. */
export async function reverseName(ip: string): Promise<string | null> {
  const hit = cache.get(ip);
  if (hit && Date.now() - hit.at < hit.ttl) return hit.name;

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), TIMEOUT_MS);
  });
  const answer = await Promise.race([reverse(ip).then((names) => names[0] ?? null, () => null), timeout]);
  clearTimeout(timer);

  const entry: Entry = answer === "timeout" ? { at: Date.now(), ttl: RETRY_MS, name: null } : { at: Date.now(), ttl: FOUND_MS, name: answer };
  remember(ip, entry);
  return entry.name;
}
