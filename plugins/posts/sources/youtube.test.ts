import { afterAll, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DAILY_SEARCHES, QUOTA_SPENT, channelsReply, resetBudgetCache, searchArea, spendSearch, streamsFrom, videosReply, youtube } from "./youtube.server";

process.env["VANTAGE_POSTS_DIR"] = mkdtempSync(join(tmpdir(), "vantage-posts-"));

/**
 * No key exists to record a live reply, so the fixtures follow the resource fields documented for search.list
 * (part=id), videos.list (part=snippet,recordingDetails,liveStreamingDetails) and channels.list (part=snippet). Ids, names and numbers are invented.
 * One stream has no location, and one is a finished broadcast.
 */
const searchJson: unknown = await Bun.file(new URL("../fixtures/youtube-search.json", import.meta.url)).json();
const videosJson: unknown = await Bun.file(new URL("../fixtures/youtube-videos.json", import.meta.url)).json();
const channelsJson: unknown = await Bun.file(new URL("../fixtures/youtube-channels.json", import.meta.url)).json();
const NOW = Date.parse("2026-10-09T05:00:00Z");

/** A stand-in for `fetch`: the handler plus Bun's `preconnect`, so it has fetch's full type. */
const fakeFetch = (handler: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>): typeof fetch => Object.assign(handler, { preconnect: fetch.preconnect });

const posts = streamsFrom({ videos: videosReply.parse(videosJson), channels: channelsReply.parse(channelsJson) }, NOW);

describe("normalising YouTube live streams", () => {
  test("keeps streams that are live now and carry a location, most watched first", () => {
    expect(posts.map((p) => p.id)).toEqual(["youtube:Xo3sRbF1k2M", "youtube:Zr4kLm8QwEr"]);
  });

  test("a stream has its position, start time, viewers and watch page", () => {
    expect(posts[0]).toMatchObject({
      source: "youtube",
      kind: "live",
      lat: 41.8992,
      lon: 12.4731,
      postedAt: "2026-10-09T04:12:30.000Z",
      title: "Roma LIVE: Piazza Navona webcam",
      photo: null,
      link: "https://www.youtube.com/watch?v=Xo3sRbF1k2M",
      detail: { videoId: "Xo3sRbF1k2M", viewers: 1342, description: "Live from Piazza Navona.", tags: ["rome", "webcam", "piazza navona"], scheduledStart: "2026-10-09T04:10:00Z", placeName: "Piazza Navona" },
    });
  });

  test("a stream that hides its viewer count has null viewers, not zero", () => {
    expect(posts[1]?.detail.viewers).toBeNull();
  });

  test("the channel comes through as the author, with its profile link and picture", () => {
    expect(posts[0]?.author).toEqual({
      name: "Example Channel Roma",
      handle: "examplechannelroma",
      profile: "https://www.youtube.com/channel/UCaB1cD2eF3gH4iJ5kL6mN7o",
      avatar: "https://yt3.ggpht.com/example-roma=s88-c-k-c0x00ffffff-no-rj",
    });
  });

  test("a channel without a custom handle has no handle", () => {
    expect(posts[1]?.author).toEqual({ name: "River Example", handle: null, profile: "https://www.youtube.com/channel/UCqQ1wW2eE3rR4tT5yY6uU7i", avatar: "https://yt3.ggpht.com/example-river=s88-c-k-c0x00ffffff-no-rj" });
  });

  test("a video id outside YouTube's alphabet is refused before it can reach the player address", () => {
    expect(videosReply.safeParse({ items: [{ id: "x\" onload=\"alert(1)" }] }).success).toBe(false);
  });

  test("nearby views share one search circle", () => {
    const a = searchArea({ west: 12.4, south: 41.8, east: 12.6, north: 42 });
    expect(a).toEqual({ centre: { lat: 41.9, lon: 12.5 }, radiusKm: 25 });
  });
});

describe("the daily search budget", () => {
  beforeEach(() => {
    process.env["VANTAGE_POSTS_DIR"] = mkdtempSync(join(tmpdir(), "vantage-posts-"));
    resetBudgetCache();
  });

  test(`allows ${DAILY_SEARCHES} searches in a Pacific day, then says when it refreshes`, async () => {
    for (let i = 0; i < DAILY_SEARCHES; i++) await spendSearch(NOW);
    await expect(spendSearch(NOW)).rejects.toThrow(QUOTA_SPENT);
  });

  test("the count survives a restart, because it lives on disk", async () => {
    for (let i = 0; i < DAILY_SEARCHES; i++) await spendSearch(NOW);
    resetBudgetCache();
    await expect(spendSearch(NOW)).rejects.toThrow(QUOTA_SPENT);
  });

  test("searches that start together all count", async () => {
    await Promise.all(Array.from({ length: DAILY_SEARCHES }, () => spendSearch(NOW)));
    await expect(spendSearch(NOW)).rejects.toThrow(QUOTA_SPENT);
    resetBudgetCache();
    await expect(spendSearch(NOW)).rejects.toThrow(QUOTA_SPENT);
  });

  test("a new day starts at midnight Pacific time, not at midnight UTC", async () => {
    const beforeMidnightPacific = Date.parse("2026-10-09T06:59:00Z");
    const afterMidnightPacific = Date.parse("2026-10-09T07:01:00Z");
    for (let i = 0; i < DAILY_SEARCHES; i++) await spendSearch(beforeMidnightPacific);
    await expect(spendSearch(beforeMidnightPacific)).rejects.toThrow(QUOTA_SPENT);
    await spendSearch(afterMidnightPacific);
  });
});

describe("the YouTube key", () => {
  const key = "AIzaSy-test-key-0123456789abcdef";
  afterAll(() => {
    delete process.env["VANTAGE_YOUTUBE_KEY"];
  });

  test("travels in a header, never in a URL, and the search spends one unit of the budget", async () => {
    process.env["VANTAGE_YOUTUBE_KEY"] = key;
    process.env["VANTAGE_POSTS_DIR"] = mkdtempSync(join(tmpdir(), "vantage-posts-"));
    resetBudgetCache();
    const seen: { url: string; key: string | null }[] = [];
    const spy = spyOn(globalThis, "fetch").mockImplementation(
      fakeFetch(async (input, init) => {
        const url = String(input);
        seen.push({ url, key: new Headers(init?.headers).get("x-goog-api-key") });
        return Response.json(url.includes("/search") ? searchJson : url.includes("/channels") ? channelsJson : videosJson);
      }),
    );
    try {
      const { posts: live } = await youtube.posts({ west: 12.4, south: 41.8, east: 12.6, north: 42 }, { locale: "en", now: NOW });
      expect(live).toHaveLength(2);
      expect(seen).toHaveLength(3);
      for (const call of seen) {
        expect(call.url).not.toContain(key);
        expect(call.key).toBe(key);
      }
      expect(seen[0]?.url).toContain("eventType=live");
      expect(seen[1]?.url).toContain("id=Xo3sRbF1k2M%2CpT7wQe9LmNa%2CZr4kLm8QwEr%2CHq2pVn6TzXc");
      expect(seen[2]?.url).toContain("/channels?part=snippet&id=UCaB1cD2eF3gH4iJ5kL6mN7o");
      const stored = await Bun.file(join(process.env["VANTAGE_POSTS_DIR"] ?? "", "posts-youtube-quota.json")).json();
      expect(stored).toEqual({ day: "2026-10-08", searches: 1 });
    } finally {
      spy.mockRestore();
    }
  });

  test("after a failed search the source pauses instead of spending the budget again", async () => {
    process.env["VANTAGE_YOUTUBE_KEY"] = key;
    process.env["VANTAGE_POSTS_DIR"] = mkdtempSync(join(tmpdir(), "vantage-posts-"));
    resetBudgetCache();
    let calls = 0;
    const spy = spyOn(globalThis, "fetch").mockImplementation(
      fakeFetch(async () => {
        calls += 1;
        return Response.json({ error: { code: 400, message: "API key not valid. Please pass a valid API key." } }, { status: 400 });
      }),
    );
    try {
      await expect(youtube.posts({ west: 2, south: 48, east: 3, north: 49 }, { locale: "en", now: NOW })).rejects.toThrow("YouTube answered HTTP 400");
      // Another area, so the cache cannot answer: the pause does.
      await expect(youtube.posts({ west: 4, south: 50, east: 5, north: 51 }, { locale: "en", now: NOW + 60_000 })).rejects.toThrow("YouTube answered HTTP 400");
      expect(calls).toBe(1);
      const stored = await Bun.file(join(process.env["VANTAGE_POSTS_DIR"] ?? "", "posts-youtube-quota.json")).json();
      expect(stored).toEqual({ day: "2026-10-08", searches: 1 });
    } finally {
      spy.mockRestore();
    }
  });
});
