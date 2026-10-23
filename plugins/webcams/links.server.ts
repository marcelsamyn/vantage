import { HttpError, describe, fetchPublic, log, webUrl } from "../../server/kit";
import { decodeEntities } from "../dossier/tenders.server";
import { USER_AGENT } from "./camera.server";
import type { CameraStream } from "./types";

/**
 * Most webcams in OpenStreetMap link to a web page, not a picture. A few platforms host most of them, and each shows
 * its picture in a way a rule can follow: an address built from the link, the page's preview picture, or a picture
 * named in the page. A picture counts only when it is an image and was updated in the last two days.
 */

/** A live picture found behind a link to a camera's page. */
export interface LinkedPicture {
  image: string;
  stream: CameraStream | null;
  /** The site that shows the camera: "Panomax", "USGS river cameras", "fl511.com". */
  platform: string;
  /** The camera's title on its page, when the page was read. */
  title: string | null;
  refreshS: number;
}

interface Found {
  image: string;
  title: string | null;
}

interface LinkRule {
  match: RegExp;
  platform: string;
  refreshS: number;
  find: (link: URL, m: RegExpExecArray) => Found | null | Promise<Found | null>;
}

const DAY_MS = 24 * 3_600_000;
/** A picture older than this belongs to a camera that stopped. */
const STALE_MS = 2 * DAY_MS;
const TIMEOUT_MS = 8_000;
/** Enough of a page to reach its <head> tags on every platform seen so far. */
const MAX_PAGE_BYTES = 256_000;
const HEADERS = { "user-agent": USER_AGENT, accept: "text/html,image/*;q=0.9,*/*;q=0.8" };
/** The links of one area read in one go; a dense area waits for its next day. */
const MAX_LINKS = 200;
/** Clocks drift; a date further ahead than this is wrong, not new. */
const FUTURE_SLACK_MS = 3_600_000;

/** Sites that are not cameras (wind stations), are already a provider (Windy), refuse VANTAGE, or keep only old copies. */
const SKIP_HOSTS = ["pioupiou.com", "balisemeteo.com", "windy.com", "webcams.travel", "udottraffic.utah.gov", "web.archive.org", "youtube.com", "youtu.be"];

/** Platforms that host many mapped cameras, with how often they take a picture. Their page preview is the live picture. */
const PLATFORMS: readonly { host: string; platform: string; refreshS: number }[] = [
  { host: "panomax.com", platform: "Panomax", refreshS: 600 },
  { host: "foto-webcam.eu", platform: "foto-webcam.eu", refreshS: 600 },
  { host: "terra-hd.de", platform: "terra-hd", refreshS: 600 },
  { host: "skaping.com", platform: "Skaping", refreshS: 600 },
  { host: "bergfex.de", platform: "Bergfex", refreshS: 900 },
  { host: "bergfex.at", platform: "Bergfex", refreshS: 900 },
  { host: "viewsurf.com", platform: "Viewsurf", refreshS: 600 },
  { host: "idokep.hu", platform: "Időkép", refreshS: 300 },
  { host: "whatsupcams.com", platform: "WhatsUpCams", refreshS: 300 },
  { host: "roundshot.com", platform: "Roundshot", refreshS: 600 },
];

const onHost = (link: URL, host: string): boolean => link.hostname === host || link.hostname.endsWith(`.${host}`);

/** The platform that shows a picture or page, by name when known, otherwise by its site. */
export function platformOf(link: URL): { platform: string; refreshS: number; known: boolean } {
  const known = PLATFORMS.find((p) => onHost(link, p.host));
  return known ? { platform: known.platform, refreshS: known.refreshS, known: true } : { platform: link.hostname.replace(/^www\./, ""), refreshS: 300, known: false };
}
const picture = (image: string, title: string | null = null): Found => ({ image, title });

/** Rules that build the picture's address from the link alone. Checked in order; the first match wins. */
const RULES: readonly LinkRule[] = [
  {
    // USGS river cameras keep the newest picture of each camera under a fixed name.
    match: /^https:\/\/apps\.usgs\.gov\/hivis\/camera\/([\w-]+)/,
    platform: "USGS river cameras",
    refreshS: 1800,
    find: (_, [, id = ""]) => picture(`https://usgs-nims-images.s3.amazonaws.com/overlay/${id}/${id}_newest.jpg`, id.replace(/_/g, " ")),
  },
  {
    // A live video's thumbnail follows the stream; it does not exist while the video is not live.
    match: /^https:\/\/(?:www\.)?(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:.*&)?v=|live\/|embed\/))([\w-]{11})/,
    platform: "YouTube",
    refreshS: 300,
    find: (_, [, id = ""]) => picture(`https://i.ytimg.com/vi/${id}/hqdefault_live.jpg`),
  },
  {
    match: /^https?:\/\/[\w.-]*ipcamlive\.com\/.*[?&]alias=(\w+)/,
    platform: "IPCamLive",
    refreshS: 60,
    find: (_, [, alias = ""]) => picture(`https://ipcamlive.com/player/snapshot.php?alias=${alias}`),
  },
  {
    match: /^https?:\/\/webtv\.feratel\.com\/webtv\/.*[?&]cam=(\d+)/,
    platform: "Feratel",
    refreshS: 600,
    find: (_, [, cam = ""]) => picture(`https://wtvthmb.feratel.com/thumbnails/${cam}.jpeg`),
  },
  {
    // National Park Service pages name the current picture in their markup.
    match: /^https?:\/\/(?:www\.)?nps\.gov\/media\/webcam\/view\.htm/,
    platform: "US National Park Service",
    refreshS: 900,
    find: async (link) => {
      const page = await readPage(link);
      const image = page.html && decodeEntities(page.html).match(/https:\/\/www\.nps\.gov\/webcams-[^"'\s]+\.jpe?g/i)?.[0];
      return image ? picture(image, page.title) : null;
    },
  },
];

/** A host that is a bare IP address; IPv6 hosts keep their brackets in a URL. */
const IP_HOST = /^(\d{1,3}\.){3}\d{1,3}$|^\[/;

/**
 * The link as a web address, with the scheme some mappers leave out. Null for anything that is not one, and for a
 * bare IP address: a camera its owner publishes has a name, while a bare address is often a device someone left open.
 */
export function webLink(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed || /\s/.test(trimmed)) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
  const url = webUrl(withScheme);
  if (!url) return null;
  const { hostname } = new URL(url);
  return hostname.includes(".") && !IP_HOST.test(hostname) ? url : null;
}

/** How to find a link's picture: a rule, the page's preview ("preview"), or nothing (null) for sites VANTAGE leaves alone. */
export function ruleFor(link: string): { rule: LinkRule; m: RegExpExecArray } | "preview" | null {
  for (const rule of RULES) {
    const m = rule.match.exec(link);
    if (m) return { rule, m };
  }
  const url = new URL(link);
  return SKIP_HOSTS.some((host) => onHost(url, host)) ? null : "preview";
}

const META = /<meta\s[^>]*>/gi;
const attr = (tag: string, name: string): string | null => tag.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, "i"))?.[1] ?? null;

/** The preview picture and title a page declares for link previews, resolved against the page's address. */
export function pageFacts(html: string, base: string): { image: string | null; title: string | null } {
  const meta = new Map<string, string>();
  for (const [tag] of html.matchAll(META)) {
    const key = (attr(tag, "property") ?? attr(tag, "name"))?.toLowerCase();
    const content = attr(tag, "content");
    if (key && content && !meta.has(key)) meta.set(key, decodeEntities(content).trim());
  }
  const raw = meta.get("og:image") ?? meta.get("og:image:url") ?? meta.get("twitter:image") ?? meta.get("twitter:image:src");
  const image = raw && URL.canParse(raw, base) ? webUrl(new URL(raw, base).href) : null;
  const heading = meta.get("og:title") ?? html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1];
  const title = heading ? decodeEntities(heading).replace(/\s+/g, " ").trim().slice(0, 120) || null : null;
  return { image, title };
}

/** When the picture was taken, from Last-Modified; "stale" when the camera stopped. */
export function pictureAge(lastModified: string | null, now: number): number | null | "stale" {
  const at = lastModified ? Date.parse(lastModified) : Number.NaN;
  if (!Number.isFinite(at)) return null;
  if (at - now > FUTURE_SLACK_MS) return null;
  return now - at > STALE_MS ? "stale" : at;
}

// ── Asking politely ───────────────────────────────────────────────

/**
 * Run tasks with at most `maxRunning` at once and `maxPerKey` for any one key, in the order they asked. A finished
 * task hands its place to the first waiters that fit, so a busy key never holds up the others.
 */
export function limiter(maxRunning: number, maxPerKey: number): <T>(key: string, task: () => Promise<T>) => Promise<T> {
  let running = 0;
  const perKey = new Map<string, number>();
  const waiting: { key: string; start: () => void }[] = [];
  const fits = (key: string): boolean => running < maxRunning && (perKey.get(key) ?? 0) < maxPerKey;
  const take = (key: string): void => {
    running++;
    perKey.set(key, (perKey.get(key) ?? 0) + 1);
  };
  const release = (key: string): void => {
    running--;
    const left = (perKey.get(key) ?? 1) - 1;
    if (left > 0) perKey.set(key, left);
    else perKey.delete(key);
    for (let i = 0; i < waiting.length && running < maxRunning; ) {
      const next = waiting[i];
      if (next && fits(next.key)) {
        waiting.splice(i, 1);
        take(next.key);
        next.start();
      } else i++;
    }
  };
  return async (key, task) => {
    if (fits(key)) take(key);
    else await new Promise<void>((start) => waiting.push({ key, start }));
    try {
      return await task();
    } finally {
      release(key);
    }
  };
}

/** At most eight requests at once and two to any one site, so reading a busy area does not hammer a platform. */
const politely = limiter(8, 2);

type Answer = { kind: "picture"; image: string; stream: CameraStream | null; dated: boolean } | { kind: "page"; html: string; final: string } | { kind: "none" };

/** Open an address and say what it is: a picture, a motion-JPEG stream, a page, or nothing usable. */
function open(address: string, now: number): Promise<Answer> {
  const url = new URL(address);
  return politely(url.hostname, async () => {
    const res = await fetchPublic(url.hostname, url, { headers: HEADERS, timeoutMs: TIMEOUT_MS });
    const type = res.headers.get("content-type") ?? "";
    if (type.startsWith("multipart/x-mixed-replace")) {
      // A motion-JPEG stream never ends; an <img> plays it, so the address itself is the picture.
      await res.body?.cancel();
      return { kind: "picture", image: address, stream: { type: "mjpeg", url: address }, dated: false };
    }
    if (type.startsWith("image/")) {
      await res.body?.cancel();
      const age = pictureAge(res.headers.get("last-modified"), now);
      return age === "stale" ? { kind: "none" } : { kind: "picture", image: address, stream: null, dated: age !== null };
    }
    if (!type.includes("html")) {
      await res.body?.cancel();
      return { kind: "none" };
    }
    return { kind: "page", html: await readHead(res), final: res.url || address };
  });
}

/** The start of a page, up to its </head>: the tags that name a preview picture are there. */
async function readHead(res: Response): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let html = "";
  try {
    while (html.length < MAX_PAGE_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      html += decoder.decode(value, { stream: true });
      if (/<\/head>/i.test(html)) break;
    }
    return html;
  } finally {
    await reader.cancel();
  }
}

async function readPage(link: URL): Promise<{ html: string | null; title: string | null }> {
  const answer = await open(link.href, Date.now());
  return answer.kind === "page" ? { html: answer.html, title: pageFacts(answer.html, answer.final).title } : { html: null, title: null };
}

/** The live picture behind one link, or null. */
async function resolveLink(link: string, now: number): Promise<LinkedPicture | null> {
  const found = ruleFor(link);
  if (!found) return null;
  const url = new URL(link);

  if (found !== "preview") {
    const hit = await found.rule.find(url, found.m);
    if (!hit) return null;
    const answer = await open(hit.image, now);
    return answer.kind === "picture" ? { image: answer.image, stream: answer.stream, platform: found.rule.platform, title: hit.title, refreshS: found.rule.refreshS } : null;
  }

  // No rule: the link itself may be the picture, or a page whose preview is the picture. A mapper who links a picture
  // directly vouches for it, as for a link that ends in .jpg, so that picture needs no date.
  const { platform, refreshS, known } = platformOf(url);
  const answer = await open(link, now);
  if (answer.kind === "picture") return { image: answer.image, stream: answer.stream, platform, title: null, refreshS };
  if (answer.kind !== "page") return null;
  const facts = pageFacts(answer.html, answer.final);
  if (!facts.image) return null;
  const preview = await open(facts.image, now);
  if (preview.kind !== "picture") return null;
  // Unknown sites often preview a fixed promotional picture; only a dated, recent one shows a live camera.
  if (!known && !preview.dated) return null;
  return { image: preview.image, stream: preview.stream, platform, title: facts.title, refreshS };
}

/**
 * The live pictures behind the links, keyed by link. A link that fails (a dead page, a refused request) has no
 * picture: one broken site must not cost the others theirs, so each failure is counted and logged once per batch.
 * When every link fails, the network is the problem, not the sites: that throws, so the answer is not kept.
 */
export async function resolveLinks(links: readonly string[], now = Date.now()): Promise<Record<string, LinkedPicture>> {
  const pictures: Record<string, LinkedPicture> = {};
  const batch = [...new Set(links)].slice(0, MAX_LINKS);
  let failed = 0;
  let lastError = "";
  await Promise.all(
    batch.map(async (link) => {
      try {
        const found = await resolveLink(link, now);
        if (found) pictures[link] = found;
      } catch (err) {
        failed++;
        lastError = describe(err);
      }
    }),
  );
  log.info("webcam links read", { links: batch.length, pictures: Object.keys(pictures).length, failed, ...(failed ? { lastError } : {}) });
  if (batch.length > 0 && failed === batch.length) throw new HttpError(502, "links_unreachable", `No camera page answered: ${lastError}`);
  return pictures;
}
