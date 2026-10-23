import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { HttpError, memo, webUrl, z } from "../../../server/kit";
import { distanceM, type LatLon } from "../../../shared/geo";
import { boxCentre } from "../box";
import { dateIn } from "../days";
import type { Box, LiveStream, PostAuthor } from "../types";
import { HEADERS, NEEDS_KEY, fetchKeyed, readKey, type PostSource } from "./source.server";

/**
 * YouTube live streams that carry a recording location, through the YouTube Data API v3 with the user's own free
 * key (VANTAGE_YOUTUBE_KEY). Search results carry no position, so a second call reads each video's
 * `recordingDetails.location`. Streams without one are dropped.
 *
 * The channel behind a stream comes from the video's snippet (channel id and title) and one `channels.list` call for
 * the channel pictures. The browser plays the stream in YouTube's own embedded player, and only after the viewer asks.
 *
 * Quota: `search.list` has its own bucket of 100 calls a day by default, reset at midnight Pacific time. VANTAGE
 * spends at most 90, counted on disk so a restart does not forget, and caches each area for 15 minutes (an hour for
 * the Briefing, which asks every few minutes). `videos.list` and `channels.list` cost 1 unit each of the general quota.
 */

const SOURCE = "YouTube";
const SEARCH = "https://www.googleapis.com/youtube/v3/search";
const VIDEOS = "https://www.googleapis.com/youtube/v3/videos";
const CHANNELS = "https://www.googleapis.com/youtube/v3/channels";
export const DAILY_SEARCHES = 90;
export const QUOTA_SPENT = "Live video refreshes again after midnight Pacific time";
const RADII_KM = [5, 10, 25, 50, 100, 250, 500, 1000] as const;
const CACHE_MS = 15 * 60_000;

// ── Daily budget, on disk ─────────────────────────────────────────

const dataDir = (): string => process.env["VANTAGE_POSTS_DIR"] ?? join(import.meta.dir, "..", "..", "..", ".data");
const budgetFile = z.object({ day: z.string(), searches: z.number() });
type Budget = z.infer<typeof budgetFile>;
/** Loaded once; every spend then changes the same object with no await in between, so concurrent searches all count. */
let budget: Promise<Budget> | null = null;
let saving: Promise<unknown> = Promise.resolve();

async function readBudget(): Promise<Budget> {
  const file = Bun.file(join(dataDir(), "posts-youtube-quota.json"));
  const parsed = budgetFile.safeParse((await file.exists()) ? await file.json().catch(() => null) : null);
  return parsed.success ? parsed.data : { day: "", searches: 0 };
}

/** Count one search against today's budget (a Pacific-time day), or refuse when it is spent. */
export async function spendSearch(now: number): Promise<void> {
  const current = await (budget ??= readBudget());
  const day = dateIn("America/Los_Angeles", now);
  if (current.day !== day) Object.assign(current, { day, searches: 0 });
  if (current.searches >= DAILY_SEARCHES) throw new HttpError(503, "quota_spent", QUOTA_SPENT);
  current.searches += 1;
  const snapshot = JSON.stringify(current);
  // Writes run one after another, so the file always ends with the latest count.
  saving = saving.then(async () => {
    await mkdir(dataDir(), { recursive: true });
    await Bun.write(join(dataDir(), "posts-youtube-quota.json"), snapshot);
  });
  await saving;
}

/** Forget the in-memory budget and any failure pause, so the next search starts from the file. For tests. */
export function resetBudgetCache(): void {
  budget = null;
  paused = null;
}

// ── Failure pause ─────────────────────────────────────────────────

/**
 * A failed search still spends quota, and a wrong or restricted key fails every time. After a failure the source
 * answers with that failure for 15 minutes instead of searching again.
 */
const PAUSE_MS = 15 * 60_000;
let paused: { until: number; error: unknown } | null = null;

// ── Upstream ──────────────────────────────────────────────────────

export const searchReply = z.object({ items: z.array(z.object({ id: z.object({ videoId: z.string().regex(/^[\w-]{6,20}$/).optional() }) })) });

const video = z.object({
  // Video ids end up in the embedded player's address, so only YouTube's own id alphabet passes.
  id: z.string().regex(/^[\w-]{6,20}$/),
  snippet: z
    .object({
      title: z.string(),
      description: z.string().optional(),
      channelId: z.string().regex(/^[\w-]{6,40}$/).optional(),
      channelTitle: z.string().optional(),
      tags: z.array(z.string()).optional(),
      publishedAt: z.string().optional(),
      liveBroadcastContent: z.string().optional(),
    })
    .optional(),
  recordingDetails: z
    .object({
      location: z.object({ latitude: z.number().optional(), longitude: z.number().optional() }).optional(),
      locationDescription: z.string().optional(),
    })
    .optional(),
  liveStreamingDetails: z
    .object({ actualStartTime: z.string().optional(), scheduledStartTime: z.string().optional(), concurrentViewers: z.union([z.string(), z.number()]).optional() })
    .optional(),
});
export const videosReply = z.object({ items: z.array(video) });
export type VideosReply = z.infer<typeof videosReply>;

export const channelsReply = z.object({
  items: z.array(z.object({ id: z.string(), snippet: z.object({ customUrl: z.string().optional(), thumbnails: z.object({ default: z.object({ url: z.string() }).optional() }).optional() }).optional() })),
});
export type ChannelsReply = z.infer<typeof channelsReply>;

/** What one search brings back: the live videos and the channels behind them. */
export interface LiveReply {
  videos: VideosReply;
  channels: ChannelsReply;
}

/** The search circle for an area: its centre, and a radius from a short list so nearby views share one search. */
export function searchArea(box: Box): { centre: LatLon; radiusKm: number } {
  const centre = boxCentre(box);
  const reach = distanceM(centre, { lat: box.north, lon: box.east }) / 1000;
  return { centre: { lat: Math.round(centre.lat * 1e4) / 1e4, lon: Math.round(centre.lon * 1e4) / 1e4 }, radiusKm: RADII_KM.find((r) => r >= reach) ?? 1000 };
}

/** Normalise videos to live posts: only streams that are live now and carry a location, most watched first. */
export function streamsFrom(raw: LiveReply, now: number): LiveStream[] {
  const channels = new Map(raw.channels.items.map((c) => [c.id, c.snippet]));
  const out: LiveStream[] = [];
  for (const v of raw.videos.items) {
    const loc = v.recordingDetails?.location;
    if (loc?.latitude === undefined || loc.longitude === undefined) continue;
    if (Math.abs(loc.latitude) > 90 || Math.abs(loc.longitude) > 180) continue;
    if (v.snippet?.liveBroadcastContent && v.snippet.liveBroadcastContent !== "live") continue;
    const started = Date.parse(v.liveStreamingDetails?.actualStartTime ?? v.snippet?.publishedAt ?? "");
    const viewers = Number(v.liveStreamingDetails?.concurrentViewers);
    const channelId = v.snippet?.channelId;
    const channel = channelId ? channels.get(channelId) : undefined;
    const channelName = v.snippet?.channelTitle?.trim() || null;
    const author: PostAuthor | null =
      channelId || channelName
        ? {
            name: channelName,
            handle: channel?.customUrl?.replace(/^@/, "") || null,
            profile: channelId ? webUrl(`https://www.youtube.com/channel/${encodeURIComponent(channelId)}`) : null,
            avatar: webUrl(channel?.thumbnails?.default?.url),
          }
        : null;
    out.push({
      id: `youtube:${v.id}`,
      source: "youtube",
      kind: "live",
      lat: loc.latitude,
      lon: loc.longitude,
      uncertaintyM: null,
      postedAt: new Date(Number.isFinite(started) ? started : now).toISOString(),
      seenAt: null,
      title: v.snippet?.title ?? "Live stream",
      subtitle: null,
      photo: null,
      author,
      link: webUrl(`https://www.youtube.com/watch?v=${encodeURIComponent(v.id)}`),
      detail: {
        videoId: v.id,
        viewers: Number.isFinite(viewers) && v.liveStreamingDetails?.concurrentViewers !== undefined ? viewers : null,
        description: v.snippet?.description?.trim() || null,
        tags: v.snippet?.tags ?? [],
        scheduledStart: v.liveStreamingDetails?.scheduledStartTime ?? null,
        placeName: v.recordingDetails?.locationDescription?.trim() || null,
      },
    });
  }
  return out.sort((a, b) => (b.detail.viewers ?? -1) - (a.detail.viewers ?? -1));
}

async function load(area: { centre: LatLon; radiusKm: number }, key: string, now: number): Promise<LiveReply> {
  if (paused && now < paused.until) throw paused.error;
  await spendSearch(now);
  try {
    return await search(area, key);
  } catch (err) {
    paused = { until: now + PAUSE_MS, error: err };
    throw err;
  }
}

async function search(area: { centre: LatLon; radiusKm: number }, key: string): Promise<LiveReply> {
  // The key travels in a header, so it is never part of a URL that an error or a log could repeat.
  const headers = { ...HEADERS, "x-goog-api-key": key };
  const search = new URL(SEARCH);
  search.search = new URLSearchParams({
    part: "id",
    type: "video",
    eventType: "live",
    location: `${area.centre.lat},${area.centre.lon}`,
    locationRadius: `${area.radiusKm}km`,
    maxResults: "50",
    safeSearch: "moderate",
  }).toString();
  const found = await fetchKeyed(SOURCE, search, searchReply, key, { headers });
  const ids = found.items.flatMap((i) => (i.id.videoId ? [i.id.videoId] : []));
  if (!ids.length) return { videos: { items: [] }, channels: { items: [] } };
  const videosUrl = new URL(VIDEOS);
  videosUrl.search = new URLSearchParams({ part: "snippet,recordingDetails,liveStreamingDetails", id: ids.join(","), maxResults: "50" }).toString();
  const videos = await fetchKeyed(SOURCE, videosUrl, videosReply, key, { headers });
  const channelIds = [...new Set(videos.items.flatMap((v) => (v.snippet?.channelId ? [v.snippet.channelId] : [])))];
  if (!channelIds.length) return { videos, channels: { items: [] } };
  const channelsUrl = new URL(CHANNELS);
  channelsUrl.search = new URLSearchParams({ part: "snippet", id: channelIds.join(","), maxResults: "50" }).toString();
  return { videos, channels: await fetchKeyed(SOURCE, channelsUrl, channelsReply, key, { headers }) };
}

export const youtube: PostSource<"youtube"> = {
  id: "youtube",
  label: "Live video (YouTube)",
  area: null,
  configured: () => readKey("youtube") !== null,
  posts: async (box, { now, maxAgeMs = CACHE_MS }) => {
    const key = readKey("youtube");
    if (!key) throw new HttpError(503, "needs_key", NEEDS_KEY);
    const area = searchArea(box);
    const raw = await memo(`posts:youtube:${area.centre.lat},${area.centre.lon},${area.radiusKm}`, maxAgeMs, () => load(area, key, now), CACHE_MS * 4);
    return { posts: streamsFrom(raw, now), capped: false };
  },
};
