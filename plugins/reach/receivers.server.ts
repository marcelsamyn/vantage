import { HttpError, diskMemo, fetchPublic, fetchUpstream, isPublicAddress, memo, parseUpstream, z } from "../../server/kit";
import type { EmbedCheck, Receiver, ReceiverList } from "./types";

const SOURCE = "KiwiSDR receiver list";
/** The public list that powers kiwisdr.com's map. kiwisdr.com/public itself sits behind a captcha. */
export const KIWI_LIST_URL = "http://rx.linkfanel.net/kiwisdr_com.js";
export const USER_AGENT = "VANTAGE/1.0 (personal dashboard; local)";

const num = z.string().transform((s) => Number(s));
const entry = z.object({
  id: z.string(),
  name: z.string(),
  status: z.string(),
  offline: z.string(),
  gps: z.string(),
  url: z.string(),
  bands: z.string(),
  users: num,
  users_max: num,
  loc: z.string().optional(),
  antenna: z.string().optional(),
  freq_offset: z.string().optional(),
});
type Entry = z.infer<typeof entry>;

/** The list is a JavaScript file (`var kiwisdr_com = [ … ,\n]`) with a trailing comma, so it is not JSON as served. */
function parseListFile(text: string): unknown {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start < 0 || end < start) throw new HttpError(502, "upstream_shape", `${SOURCE} sent a file without a receiver list`);
  try {
    return JSON.parse(text.slice(start, end + 1).replace(/,\s*\]$/, "]"));
  } catch {
    throw new HttpError(502, "upstream_shape", `${SOURCE} sent a list that is not valid JSON`);
  }
}

function listedAt(text: string): number {
  const stamp = /data timestamp: (.+)/.exec(text)?.[1];
  const parsed = stamp ? Date.parse(stamp.replace(/^\w+, /, "").replace(/-/g, " ")) : NaN;
  return Number.isFinite(parsed) ? parsed : Date.now();
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
function plain(s: string | undefined): string | null {
  const t = (s ?? "")
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
      if (e.startsWith("#")) {
        const code = e[1]?.toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : m;
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/[⁠-⁯​-‏]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return t.length ? t.slice(0, 160) : null;
}

function toReceiver(e: Entry): Receiver | null {
  if (e.status !== "active" || e.offline === "yes") return null;
  const gps = /^\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)$/.exec(e.gps);
  const [lo, hi] = e.bands.split("-").map(Number);
  if (!gps || lo === undefined || hi === undefined || !Number.isFinite(lo) || !Number.isFinite(hi)) return null;
  const lat = Number(gps[1]);
  const lon = Number(gps[2]);
  // (0, 0) is the "no position" default, and a frequency offset means a converter shifts the dial: skip both, they would mislead.
  if ((lat === 0 && lon === 0) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  if (e.freq_offset && Number(e.freq_offset) !== 0) return null;
  // Anyone can list a receiver, so an entry that points into a private network is dropped.
  if (!/^https?:\/\//.test(e.url) || !URL.canParse(e.url) || e.users_max < 1) return null;
  const host = new URL(e.url).hostname.replace(/^\[|\]$/g, "");
  if (/^[\d.]+$|:/.test(host) && !isPublicAddress(host)) return null;
  return { kind: "kiwisdr", id: e.id, name: plain(e.name) ?? e.id, lat, lon, place: plain(e.loc), antenna: plain(e.antenna), minHz: lo, maxHz: hi, users: e.users, slots: e.users_max, url: e.url };
}

/**
 * WebSDR receivers worth naming. websdr.org's own list forbids reuse by other sites and programs without permission,
 * so it is not read; this is one well-known receiver, listed by hand, with no live listener count. A WebSDR can be
 * tuned by many people at once, so it has no seat limit.
 */
const WEBSDRS: Receiver[] = [
  {
    kind: "websdr",
    id: "websdr-twente",
    name: "WebSDR at the University of Twente",
    lat: 52.2389,
    lon: 6.8567,
    place: "Enschede, Netherlands",
    antenna: "Mini-Whip",
    minHz: 0,
    maxHz: 29_000_000,
    users: null,
    slots: null,
    url: "http://websdr.ewi.utwente.nl:8901/",
  },
];

const StoredReceivers = z.object({
  listedAt: z.number(),
  receivers: z.array(
    z.object({
      kind: z.enum(["kiwisdr", "websdr"]),
      id: z.string(),
      name: z.string(),
      lat: z.number(),
      lon: z.number(),
      place: z.string().nullable(),
      antenna: z.string().nullable(),
      minHz: z.number(),
      maxHz: z.number(),
      users: z.number().nullable(),
      slots: z.number().nullable(),
      url: z.string(),
    }),
  ),
});

/** Public KiwiSDR receivers plus the hand-listed WebSDRs. Cached for ten minutes: the Kiwi list refreshes about every fifteen. */
export function receivers(): Promise<ReceiverList> {
  return diskMemo("reach-kiwisdr", 10 * 60_000, async () => {
    const res = await fetchUpstream(SOURCE, KIWI_LIST_URL, { headers: { "user-agent": USER_AGENT }, timeoutMs: 20_000 });
    const text = await res.text();
    const raw = parseUpstream(SOURCE, z.array(entry), parseListFile(text));
    return { listedAt: listedAt(text), receivers: [...raw.map(toReceiver).filter((r): r is Receiver => r !== null), ...WEBSDRS] } satisfies ReceiverList;
  }, StoredReceivers);
}

/**
 * Whether a receiver's web page may be shown inside another page. A receiver that sends `X-Frame-Options`, or a
 * `frame-ancestors` rule that is not `*`, forbids it, and the browser would show a blank panel. The address comes from
 * the list this server loaded, never from the browser.
 */
export function embeddable(id: string): Promise<EmbedCheck> {
  return memo(`reach-embed:${id}`, 3_600_000, async () => {
    const receiver = (await receivers()).receivers.find((r) => r.id === id);
    if (!receiver) throw new HttpError(404, "unknown_receiver", "That receiver is no longer on the list.");
    const res = await fetchPublic(`Receiver ${receiver.name}`, receiver.url, { headers: { "user-agent": USER_AGENT, accept: "text/html" }, timeoutMs: 8_000 });
    await res.body?.cancel().catch(() => undefined);
    const frameOptions = res.headers.get("x-frame-options");
    const ancestors = /frame-ancestors([^;]*)/i.exec(res.headers.get("content-security-policy") ?? "")?.[1]?.trim();
    if (frameOptions) return { embeddable: false, reason: `The receiver sends X-Frame-Options: ${frameOptions}.` } satisfies EmbedCheck;
    if (ancestors !== undefined && !ancestors.split(/\s+/).includes("*")) return { embeddable: false, reason: "The receiver's content security policy forbids framing." } satisfies EmbedCheck;
    return { embeddable: true, reason: null } satisfies EmbedCheck;
  });
}
