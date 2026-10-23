import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { flickr, flickrReply, photosFrom, shortLink } from "./flickr.server";

/**
 * No key exists to record a live reply, so the fixture follows the field list of flickr.photos.search with the extras
 * VANTAGE asks for (owner_name, icon_server, path_alias, description, tags, views), in the JSON shape the REST API sends
 * (some numbers as strings, some not). Names and ids in it are invented.
 */
const raw: unknown = await Bun.file(new URL("../fixtures/flickr.json", import.meta.url)).json();
const NOW = Date.parse("2026-10-09T05:00:00Z");
const parsed = flickrReply.parse(raw);
if (parsed.stat !== "ok") throw new Error("fixture must be a successful reply");
const posts = photosFrom(parsed.photos, NOW);
const byId = (id: string) => posts.find((p) => p.id === `flickr:${id}`);

/** A stand-in for `fetch`: the handler plus Bun's `preconnect`, so it has fetch's full type. */
const fakeFetch = (handler: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>): typeof fetch => Object.assign(handler, { preconnect: fetch.preconnect });

const BASE58 = "123456789abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ";
const decode = (s: string): bigint => [...s].reduce((n, c) => n * 58n + BigInt(BASE58.indexOf(c)), 0n);

describe("normalising Flickr photos", () => {
  test("keeps photos uploaded in the last 24 hours with a real position, newest first; a malformed photo drops out alone", () => {
    expect(posts.map((p) => p.id)).toEqual(["flickr:54871230411", "flickr:54870555566", "flickr:54871100022", "flickr:54870999933", "flickr:54870888844"]);
  });

  test("a photo has its upload time, the camera's wall-clock time and a short link", () => {
    const p = byId("54871230411");
    expect(p).toMatchObject({ source: "flickr", kind: "photo", lat: 41.892, lon: 12.4707, postedAt: "2026-10-09T04:50:00.000Z", seenAt: "2026-10-09T06:41:12", title: "Ponte Sisto at dawn" });
    expect(p?.link).toStartWith("https://flic.kr/p/");
    expect(decode(p?.link?.slice("https://flic.kr/p/".length) ?? "")).toBe(54871230411n);
  });

  test("numbers sent as strings or as numbers read the same; an unknown taken date is null", () => {
    expect(byId("54871100022")).toMatchObject({ lat: 41.9009, lon: 12.4833, title: "Untitled photo" });
    expect(byId("54870555566")?.photo?.licence).toBe("CC BY-NC 4.0");
    expect(byId("54870888844")?.seenAt).toBeNull();
    expect(byId("54870888844")?.uncertaintyM).toBe(9766);
  });

  test("the short link encodes the id in Flickr's base 58", () => {
    expect(shortLink("1")).toBe("https://flic.kr/p/2");
    expect(shortLink("58")).toBe("https://flic.kr/p/21");
    expect(shortLink("not-a-number")).toBeNull();
  });
});

describe("Flickr licences", () => {
  test("a CC 4.0 photo is shown with its owner and licence in the credit", () => {
    expect(byId("54871230411")?.photo).toEqual({
      url: "https://live.staticflickr.com/65535/54871230411_a1b2c3d4e5_z.jpg",
      thumb: "https://live.staticflickr.com/65535/54871230411_a1b2c3d4e5_q.jpg",
      credit: "Photo: Jane Example on Flickr · CC BY 4.0",
      licence: "CC BY 4.0",
    });
  });

  test("an all-rights-reserved photo and a CC 2.0 photo are shown with their credit, and keep the link to Flickr", () => {
    expect(byId("54870999933")).toMatchObject({ photo: { licence: "All rights reserved", credit: "Photo: Studio Example on Flickr · All rights reserved" }, detail: { licence: "All rights reserved" } });
    expect(byId("54871100022")).toMatchObject({ photo: { licence: "CC BY 2.0", credit: "Photo: John Example on Flickr · CC BY 2.0" }, detail: { licence: "CC BY 2.0" } });
    for (const p of posts) expect(p.link).toStartWith("https://flic.kr/p/");
  });

  test("a CC0 photo is shown; a large image address that is not a web address falls back to the thumbnail", () => {
    expect(byId("54870888844")?.photo).toMatchObject({ licence: "CC0 1.0", url: "https://live.staticflickr.com/65535/54870888844_1f2e3d4c5b_q.jpg" });
  });
});

describe("people", () => {
  test("the owner comes through as the author: name, alias, buddy icon and a profile link", () => {
    expect(byId("54871230411")?.author).toEqual({
      name: "Jane Example",
      handle: "jane_example",
      profile: "https://www.flickr.com/people/12345678@N00/",
      avatar: "https://farm8.staticflickr.com/7890/buddyicons/12345678@N00.jpg",
    });
  });

  test("an owner with no alias and no custom icon has neither", () => {
    expect(byId("54871100022")?.author).toEqual({ name: "John Example", handle: null, profile: "https://www.flickr.com/people/87654321@N02/", avatar: null });
  });

  test("a photo without an owner has no author and a credit without a name", () => {
    const [first] = parsed.photos.photo;
    const { owner: _owner, ownername: _name, ...bare } = first as Record<string, unknown>;
    const [post] = photosFrom({ ...parsed.photos, photo: [bare] }, NOW);
    expect(post?.author).toBeNull();
    expect(post?.photo?.credit).toBe("Photo on Flickr · CC BY 4.0");
  });

  test("description, tags and views come through; empty ones are empty", () => {
    expect(byId("54871230411")?.detail).toEqual({ licence: "CC BY 4.0", description: "First light on the footbridge, taken before the market opened.", tags: ["rome", "ponte", "sisto", "dawn"], views: 412 });
    expect(byId("54870999933")?.detail).toMatchObject({ description: null, tags: [], views: 7 });
  });
});

describe("Flickr errors", () => {
  afterEach(() => {
    delete process.env["VANTAGE_FLICKR_KEY"];
  });

  test("without a key the source says so and fetches nothing", async () => {
    const spy = spyOn(globalThis, "fetch");
    try {
      expect(flickr.configured()).toBe(false);
      await expect(flickr.posts({ west: 12.4, south: 41.8, east: 12.6, north: 42 }, { locale: "en", now: NOW })).rejects.toThrow("Needs a free key: see README");
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  test("Flickr's own error reply becomes a message without the key", async () => {
    const key = "f1ickr-test-key-0123456789";
    process.env["VANTAGE_FLICKR_KEY"] = key;
    const spy = spyOn(globalThis, "fetch").mockImplementation(fakeFetch(async () => Response.json({ stat: "fail", code: 100, message: `Invalid API Key (Key not found: ${key})` })));
    try {
      const failure = await flickr.posts({ west: 1, south: 1, east: 1.1, north: 1.1 }, { locale: "en", now: NOW }).catch((err: unknown) => err);
      if (!(failure instanceof Error)) throw new Error("expected the search to fail");
      expect(failure.message).toContain("Invalid API Key");
      expect(failure.message).not.toContain(key);
    } finally {
      spy.mockRestore();
    }
  });
});
