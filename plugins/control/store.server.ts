import { chmod, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { HttpError, z } from "../../server/kit";
import type { Endpoint } from "./driver.server";

/**
 * `.data/control.json`, readable by this user only (mode 0600). It holds pairing secrets (a Hue username),
 * the macOS apps the user allowed VANTAGE to control, and the network devices discovery has seen.
 * Secrets never leave the server: the browser only learns whether a device is paired.
 */

// The override lets tests keep their files away from the user's real pairings.
const DIR = process.env["VANTAGE_CONTROL_DIR"] ?? join(import.meta.dir, "..", "..", ".data");
const FILE = join(DIR, "control.json");

const endpointSchema = z.object({
  key: z.string(),
  driver: z.string(),
  kind: z.enum(["computer", "player", "automation", "hub", "light", "printer", "speaker", "tv", "plug", "other"]),
  name: z.string(),
  group: z.string(),
  local: z.boolean(),
  url: z.string().nullable(),
  movedTo: z.string().optional(),
  meta: z.record(z.string(), z.string()),
  seenAt: z.number(),
}) satisfies z.ZodType<Endpoint>;

const storeSchema = z.object({
  /** Per endpoint key: the secrets its driver needs, e.g. { username } for a Hue bridge. */
  secrets: z.record(z.string(), z.record(z.string(), z.string())).default({}),
  /** macOS Automation targets the user chose to allow, e.g. "music". */
  allowed: z.array(z.string()).default([]),
  /** Network endpoints by key, with when discovery last saw them. */
  endpoints: z.record(z.string(), endpointSchema).default({}),
});

type Store = z.infer<typeof storeSchema>;

let cached: Store | null = null;
/** Writes run one after another so two quick changes never overwrite each other. */
let queue: Promise<unknown> = Promise.resolve();

async function load(): Promise<Store> {
  if (cached) return cached;
  const file = Bun.file(FILE);
  const raw: unknown = (await file.exists()) ? await file.json().catch(() => null) : {};
  const parsed = storeSchema.safeParse(raw);
  if (!parsed.success) throw new HttpError(500, "store_damaged", "The file .data/control.json is damaged. Delete it to start over; you will need to pair your devices again.");
  cached = parsed.data;
  return cached;
}

function update(change: (store: Store) => void): Promise<void> {
  const task = queue.then(async () => {
    const store = await load();
    change(store);
    await mkdir(DIR, { recursive: true, mode: 0o700 });
    // The mode applies when the file is created; chmod also repairs a file someone loosened by hand.
    await writeFile(FILE, JSON.stringify(store, null, 2), { mode: 0o600 });
    await chmod(FILE, 0o600);
  });
  queue = task.catch(() => undefined);
  return task;
}

export async function secretsOf(key: string): Promise<Record<string, string>> {
  return (await load()).secrets[key] ?? {};
}

/**
 * Store the secrets of a pairing together with the address it was made at. The endpoint takes that address too, and
 * forgets any newer address a scan saw. This is the only way a pairing changes: a scan or a failed read never does.
 */
export function savePairing(key: string, values: Record<string, string>, url: string): Promise<void> {
  return update((store) => {
    store.secrets[key] = values;
    const endpoint = store.endpoints[key];
    if (!endpoint) return;
    const { movedTo: _forgotten, ...rest } = endpoint;
    store.endpoints[key] = { ...rest, url };
  });
}

export async function isAllowed(target: string): Promise<boolean> {
  return (await load()).allowed.includes(target);
}

export function allow(target: string): Promise<void> {
  return update((store) => {
    if (!store.allowed.includes(target)) store.allowed.push(target);
  });
}

export async function rememberedEndpoints(): Promise<Endpoint[]> {
  return Object.values((await load()).endpoints);
}

/** The most endpoints kept. A hostile host announcing many devices cannot grow the store past this. */
export const MAX_ENDPOINTS = 64;

/**
 * Record what a scan found, forget endpoints not seen for `forgetAfterMs`, and keep at most `max`, dropping the
 * oldest unpaired ones first. A paired endpoint keeps the address it was paired at: when a scan sees the same
 * key somewhere else, that address is noted in `movedTo` and the driver decides what to do with it.
 */
export function rememberEndpoints(found: Endpoint[], forgetAfterMs: number, max: number = MAX_ENDPOINTS): Promise<void> {
  return update((store) => {
    const confirmed = new Set<string>();
    const strangers: Endpoint[] = [];
    for (const endpoint of found) {
      const known = store.endpoints[endpoint.key];
      if (known && store.secrets[endpoint.key] && known.url !== endpoint.url) strangers.push(endpoint);
      else {
        store.endpoints[endpoint.key] = endpoint;
        confirmed.add(endpoint.key);
      }
    }
    // A copycat announced beside the real bridge must not mark it as moved: only a key missing at its paired address does.
    for (const endpoint of strangers) {
      const known = store.endpoints[endpoint.key];
      if (!known || confirmed.has(endpoint.key)) continue;
      const { movedTo: _old, ...rest } = known;
      store.endpoints[endpoint.key] = { ...rest, ...(endpoint.url ? { movedTo: endpoint.url } : {}) };
    }
    const cutoff = Date.now() - forgetAfterMs;
    for (const [key, endpoint] of Object.entries(store.endpoints)) if (endpoint.seenAt < cutoff) delete store.endpoints[key];
    const paired = (key: string): boolean => store.secrets[key] !== undefined;
    const evictionOrder = Object.entries(store.endpoints).sort(([ka, a], [kb, b]) => Number(paired(ka)) - Number(paired(kb)) || a.seenAt - b.seenAt);
    for (const [key] of evictionOrder.slice(0, Math.max(0, evictionOrder.length - max))) delete store.endpoints[key];
  });
}
