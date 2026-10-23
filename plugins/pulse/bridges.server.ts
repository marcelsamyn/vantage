import { HttpError, diskMemo, fetchUpstream, log, memo, z } from "../../server/kit";
import { distanceM } from "../../shared/geo";
import { overpass, positionOf } from "../grid/overpass.server";
import type { Bridge, BridgeFeed, BridgeOpening } from "./types";

/**
 * Dutch movable bridges. NDW (the national road data portal) publishes the planned openings of about 70 bridges
 * as DATEX II, CC0, refreshed every five minutes. The feed carries a position and a RIS-index code but no names,
 * so each bridge borrows the name of the nearest movable bridge mapped in OpenStreetMap.
 */

const SOURCE = "NDW bridge openings";
const URL_FEED = "https://opendata.ndw.nu/planningsfeed_brugopeningen.xml.gz";
const MATCH_M = 150;
/** Openings further out than this are not worth a countdown. */
const HORIZON_MS = 36 * 3_600_000;

const field = (block: string, tag: string): string | undefined => block.match(new RegExp(`<${tag}>([^<]*)</${tag}>`))?.[1];

interface Situation {
  code: string;
  lat: number;
  lon: number;
  from: number;
  until: number | null;
  /** "certain" or "riskOf": a bridge that is open versus a window in which it may open. */
  probability: string;
  status: string;
}

function parse(xml: string): { situations: Situation[]; publishedAt: number } {
  const publishedAt = Date.parse(field(xml, "com:publicationTime") ?? "") || Date.now();
  const situations: Situation[] = [];
  for (const block of xml.split("<sit:situation ").slice(1)) {
    const code = field(block, "loc:externalLocationCode");
    const lat = Number(field(block, "loc:latitude"));
    const lon = Number(field(block, "loc:longitude"));
    const from = Date.parse(field(block, "com:overallStartTime") ?? "");
    if (!code || !Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(from)) continue;
    const end = Date.parse(field(block, "com:overallEndTime") ?? "");
    situations.push({ code, lat, lon, from, until: Number.isFinite(end) ? end : null, probability: field(block, "sit:probabilityOfOccurrence") ?? "", status: field(block, "sit:operatorActionStatus") ?? "" });
  }
  if (situations.length === 0) throw new HttpError(502, "upstream_shape", `${SOURCE} sent a schedule with no openings`);
  return { situations, publishedAt };
}

async function loadFeed(): Promise<{ situations: Situation[]; publishedAt: number }> {
  const res = await fetchUpstream(SOURCE, URL_FEED, { timeoutMs: 25_000, headers: { accept: "application/xml, */*" } });
  const bytes = new Uint8Array(await res.arrayBuffer());
  // The file is gzip on disk and is served as-is, without a content-encoding header.
  const xml = new TextDecoder().decode(bytes[0] === 0x1f && bytes[1] === 0x8b ? Bun.gunzipSync(bytes) : bytes);
  return parse(xml);
}

// ── Names ─────────────────────────────────────────────────────────

interface NamedBridge {
  name: string;
  lat: number;
  lon: number;
}

const StoredNames = z.array(z.object({ name: z.string(), lat: z.number(), lon: z.number() }));

/** Names an order-independent, short key for a set of bridge codes: the same set always maps to the same key and a different set does not. */
export function bridgeSetKey(codes: Iterable<string>): string {
  return new Bun.CryptoHasher("sha1").update([...codes].sort().join("\n")).digest("hex").slice(0, 12);
}

/**
 * Named movable bridges within matching distance of the scheduled ones. One small Overpass query covers all of them,
 * far lighter than asking for every movable bridge in the country, and the answer is kept for a week.
 */
function loadNames(key: string, points: readonly { lat: number; lon: number }[]): Promise<NamedBridge[]> {
  return diskMemo(`pulse-nl-bridge-names-${key}`, 7 * 24 * 3_600_000, async () => {
    const around = points.map((p) => `way["bridge:movable"](around:${MATCH_M},${p.lat},${p.lon});way["bridge"="movable"](around:${MATCH_M},${p.lat},${p.lon});`).join("");
    const elements = await overpass(`(${around});out center tags;`, 60);
    const out: NamedBridge[] = [];
    for (const el of elements) {
      const pos = positionOf(el);
      const name = el.tags["name"];
      if (pos && name) out.push({ name, lat: pos.lat, lon: pos.lon });
    }
    return out;
  }, StoredNames);
}

let warming: { key: string; names: Promise<NamedBridge[]> } | null = null;
let retryAt = 0;

/** Names if they are ready within a moment; otherwise start fetching them and answer without. Overpass is shared and often busy, so a failure waits five minutes before the next try. */
async function namesIfReady(scheduled: ReadonlyMap<string, { lat: number; lon: number }>): Promise<NamedBridge[]> {
  const key = bridgeSetKey(scheduled.keys());
  if ((!warming || warming.key !== key) && Date.now() < retryAt) return [];
  if (!warming || warming.key !== key) {
    warming = {
      key,
      names: loadNames(key, [...scheduled.values()]).catch((err: unknown) => {
        warming = null;
        retryAt = Date.now() + 5 * 60_000;
        log.warn("bridge names unavailable", { error: err instanceof Error ? err.message : String(err) });
        return [];
      }),
    };
  }
  const ready = Symbol("ready");
  const first = await Promise.race([warming.names, new Promise<typeof ready>((resolve) => setTimeout(() => resolve(ready), 1_200))]);
  return first === ready ? [] : first;
}

function nearestName(names: readonly NamedBridge[], p: { lat: number; lon: number }): string | null {
  let best: { name: string; d: number } | null = null;
  for (const n of names) {
    // Skip the haversine for anything more than a few hundred metres away.
    if (Math.abs(n.lat - p.lat) > 0.003 || Math.abs(n.lon - p.lon) > 0.005) continue;
    const d = distanceM(p, n);
    if (d <= MATCH_M && (!best || d < best.d)) best = { name: n.name, d };
  }
  return best?.name ?? null;
}

// ── Feed ──────────────────────────────────────────────────────────

function phaseOf(s: Situation, now: number): BridgeOpening["phase"] | null {
  if (s.until === null) return s.from <= now ? "reported" : "planned";
  if (s.until <= now) return null;
  return s.from <= now ? "window" : "planned";
}

export async function bridgeFeed(): Promise<BridgeFeed> {
  const { situations, publishedAt } = await memo("pulse:bridges:feed", 120_000, loadFeed, 3_600_000);
  const now = Date.now();
  const scheduled = new Map<string, { lat: number; lon: number }>();
  for (const s of situations) if (phaseOf(s, now) && s.from <= now + HORIZON_MS) scheduled.set(s.code, s);
  const names = await namesIfReady(scheduled);
  const byCode = new Map<string, Bridge>();
  for (const s of situations) {
    const phase = phaseOf(s, now);
    if (!phase || s.from > now + HORIZON_MS) continue;
    let bridge = byCode.get(s.code);
    if (!bridge) {
      bridge = { code: s.code, name: nearestName(names, s), lat: s.lat, lon: s.lon, now: null, upcoming: [] };
      byCode.set(s.code, bridge);
    }
    const opening: BridgeOpening = { phase, from: s.from, until: s.until };
    if (phase === "planned") bridge.upcoming.push(opening);
    // A reported-open bridge outranks a planned window that overlaps it.
    else if (!bridge.now || phase === "reported") bridge.now = opening;
  }
  const bridges = [...byCode.values()];
  for (const b of bridges) b.upcoming.sort((x, y) => x.from - y.from);
  return { bridges, publishedAt };
}
