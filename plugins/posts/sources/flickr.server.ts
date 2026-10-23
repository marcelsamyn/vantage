import { HttpError, memo, webUrl, z } from "../../../server/kit";
import type { Box, PhotoPost, PostAuthor, PostPhoto } from "../types";
import { HEADERS, NEEDS_KEY, fetchKeyed, rateGate, readKey, redact, type PostSource } from "./source.server";

/**
 * Flickr photos uploaded in the last 24 hours with a position, through `flickr.photos.search` with the user's own
 * free non-commercial key (VANTAGE_FLICKR_KEY).
 *
 * The request adds the photo's owner (name, path alias, icon server), description, tags and view count to the photo.
 * Each photo links back to its page through Flickr's short link (https://flic.kr/p/…), as Flickr requires, and its
 * owner's page opens on Flickr; VANTAGE fetches nothing else about the owner.
 *
 * Licences: every photo is shown whatever its licence, with its owner's name and the licence in the credit.
 */

const SOURCE = "Flickr";
const API = "https://www.flickr.com/services/rest/";
const WINDOW_MS = 24 * 3_600_000;
/** Flickr's largest page for a geo search. */
const PER_PAGE = 250;
/** Flickr allows 3,600 calls an hour per key; VANTAGE stays far under. */
const gate = rateGate(SOURCE, 30);
export const NOTICE = "This product uses the Flickr API but is not endorsed or certified by SmugMug, Inc.";

/** Licence ids from flickr.photos.licenses.getInfo. Ids 1 to 6 are the CC 2.0 licences, 11 to 16 the CC 4.0 ones. */
const LICENCES: Record<number, string> = {
  0: "All rights reserved",
  1: "CC BY-NC-SA 2.0",
  2: "CC BY-NC 2.0",
  3: "CC BY-NC-ND 2.0",
  4: "CC BY 2.0",
  5: "CC BY-SA 2.0",
  6: "CC BY-ND 2.0",
  7: "No known copyright restrictions",
  8: "United States Government Work",
  9: "CC0 1.0",
  10: "Public Domain Mark 1.0",
  11: "CC BY 4.0",
  12: "CC BY-SA 4.0",
  13: "CC BY-ND 4.0",
  14: "CC BY-NC 4.0",
  15: "CC BY-NC-SA 4.0",
  16: "CC BY-NC-ND 4.0",
};

const photo = z.object({
  id: z.union([z.string(), z.number()]).transform(String),
  title: z.string().optional(),
  latitude: z.coerce.number(),
  longitude: z.coerce.number(),
  accuracy: z.coerce.number().optional(),
  dateupload: z.coerce.number(),
  datetaken: z.string().optional(),
  datetakenunknown: z.coerce.number().optional(),
  license: z.coerce.number(),
  owner: z.string().optional(),
  ownername: z.string().optional(),
  pathalias: z.string().optional(),
  iconserver: z.coerce.number().optional(),
  iconfarm: z.coerce.number().optional(),
  description: z.object({ _content: z.string() }).optional(),
  tags: z.string().optional(),
  views: z.coerce.number().optional(),
  url_q: z.string().optional(),
  url_z: z.string().optional(),
});
export const flickrReply = z.discriminatedUnion("stat", [
  // Each photo is checked on its own in `photosFrom`, so one malformed photo drops out instead of failing the page.
  z.object({ stat: z.literal("ok"), photos: z.object({ total: z.coerce.number(), photo: z.array(z.unknown()) }) }),
  z.object({ stat: z.literal("fail"), code: z.coerce.number().optional(), message: z.string().optional() }),
]);
export type FlickrReply = z.infer<typeof flickrReply>;
type FlickrPage = Extract<FlickrReply, { stat: "ok" }>["photos"];

const BASE58 = "123456789abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ";

/** Flickr's short photo link: the photo id in base 58 (https://www.flickr.com/services/api/misc.urls.html). */
export function shortLink(id: string): string | null {
  if (!/^\d+$/.test(id)) return null;
  let n = BigInt(id);
  let out = "";
  while (n > 0n) {
    out = (BASE58[Number(n % 58n)] ?? "") + out;
    n /= 58n;
  }
  return webUrl(`https://flic.kr/p/${out || "1"}`);
}

/** Flickr's geo accuracy runs from 1 (world) to 16 (street). Each step halves the area named. */
const accuracyM = (level: number | undefined): number | null => (level && level >= 1 && level <= 16 ? Math.round(20_000_000 / 2 ** level) : null);

const licenceName = (id: number): string => LICENCES[id] ?? "Unknown licence";

const NSID = /^\d+@N\d+$/;

function photoOf(p: z.infer<typeof photo>, owner: string | null): PostPhoto | null {
  const licence = licenceName(p.license);
  const thumb = webUrl(p.url_q);
  const url = webUrl(p.url_z) ?? thumb;
  if (!thumb || !url) return null;
  return { url, thumb, credit: `Photo${owner ? `: ${owner}` : ""} on Flickr · ${licence}`, licence };
}

/** The owner as Flickr names them. The buddy icon address follows https://www.flickr.com/services/api/misc.buddyicons.html. */
function authorOf(p: z.infer<typeof photo>): PostAuthor | null {
  const nsid = p.owner && NSID.test(p.owner) ? p.owner : null;
  const name = p.ownername?.trim() || null;
  if (!nsid && !name) return null;
  const icon = nsid && p.iconserver && p.iconserver > 0 ? `https://farm${p.iconfarm ?? 0}.staticflickr.com/${p.iconserver}/buddyicons/${nsid}.jpg` : null;
  return {
    name,
    handle: p.pathalias || null,
    profile: nsid ? webUrl(`https://www.flickr.com/people/${nsid}/`) : null,
    avatar: webUrl(icon),
  };
}

/** Normalise one page: photos uploaded in the last 24 h with a usable position, newest first. */
export function photosFrom(raw: FlickrPage, now: number): PhotoPost[] {
  const out: PhotoPost[] = [];
  for (const item of raw.photo) {
    const parsed = photo.safeParse(item);
    if (!parsed.success) continue;
    const p = parsed.data;
    const posted = p.dateupload * 1000;
    if (now - posted > WINDOW_MS) continue;
    if (!Number.isFinite(p.latitude) || !Number.isFinite(p.longitude) || Math.abs(p.latitude) > 90 || Math.abs(p.longitude) > 180) continue;
    if (p.latitude === 0 && p.longitude === 0) continue;
    // "2026-10-08 18:04:11" is the camera's wall-clock time with no zone; keep it as such.
    const taken = p.datetakenunknown === 1 || !p.datetaken ? null : p.datetaken.replace(" ", "T");
    const author = authorOf(p);
    out.push({
      id: `flickr:${p.id}`,
      source: "flickr",
      kind: "photo",
      lat: p.latitude,
      lon: p.longitude,
      uncertaintyM: accuracyM(p.accuracy),
      postedAt: new Date(posted).toISOString(),
      seenAt: taken,
      title: p.title?.trim() || "Untitled photo",
      subtitle: null,
      photo: photoOf(p, author?.name ?? null),
      author,
      link: shortLink(p.id),
      detail: {
        licence: licenceName(p.license),
        description: p.description?._content.trim() || null,
        tags: p.tags?.split(/\s+/).filter(Boolean) ?? [],
        views: p.views ?? null,
      },
    });
  }
  return out.sort((a, b) => Date.parse(b.postedAt) - Date.parse(a.postedAt));
}

async function load(box: Box, key: string, now: number): Promise<FlickrPage> {
  gate();
  const url = new URL(API);
  url.search = new URLSearchParams({
    method: "flickr.photos.search",
    api_key: key,
    bbox: `${box.west},${box.south},${box.east},${box.north}`,
    min_upload_date: String(Math.floor((now - WINDOW_MS) / 1000)),
    has_geo: "1",
    extras: "geo,date_upload,date_taken,license,owner_name,icon_server,path_alias,description,tags,views,url_q,url_z",
    sort: "date-posted-desc",
    safe_search: "1",
    content_type: "1",
    per_page: String(PER_PAGE),
    format: "json",
    nojsoncallback: "1",
  }).toString();
  const data = await fetchKeyed(SOURCE, url, flickrReply, key, { headers: HEADERS, timeoutMs: 15_000 });
  // Flickr reports its own errors inside a 200 reply; an invalid key is code 100.
  if (data.stat === "fail") throw new HttpError(502, "upstream_refused", redact(`Flickr refused the search: ${data.message ?? `code ${data.code ?? "unknown"}`}`, key));
  return data.photos;
}

export const flickr: PostSource<"flickr"> = {
  id: "flickr",
  label: "Photos (Flickr)",
  area: null,
  configured: () => readKey("flickr") !== null,
  posts: async (box, { now }) => {
    const key = readKey("flickr");
    if (!key) throw new HttpError(503, "needs_key", NEEDS_KEY);
    const raw = await memo(`posts:flickr:${box.west},${box.south},${box.east},${box.north}`, 5 * 60_000, () => load(box, key, now));
    return { posts: photosFrom(raw, now), capped: raw.total > raw.photo.length };
  },
};
