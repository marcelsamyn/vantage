import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { BunRequest } from "bun";
import { HttpError } from "../../server/kit";
import api, { near } from "./api";
import { snapBox } from "./box";
import type { PostsReply } from "./types";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/**
 * These tests describe a server with no optional key set. Bun reads the `.env` of the checkout into every test
 * process, and a test file that runs earlier may have set one, so the keys are cleared here rather than assumed.
 */
beforeEach(() => {
  delete process.env["VANTAGE_YOUTUBE_KEY"];
  delete process.env["VANTAGE_FLICKR_KEY"];
});

const inat: unknown = await Bun.file(new URL("./fixtures/inaturalist.json", import.meta.url)).json();
const fms: unknown = await Bun.file(new URL("./fixtures/fixmystreet.json", import.meta.url)).json();
const codes: unknown = await Bun.file(new URL("./fixtures/fixmystreet-codes.json", import.meta.url)).json();

/** Stands in for the upstreams: iNaturalist answers with `inatStatus`, Fix My Street with its recorded replies. */
function fakeUpstreams(inatStatus = 200): string[] {
  const asked: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);
    asked.push(url);
    if (url.includes("inaturalist")) return inatStatus === 200 ? Response.json(inat) : new Response("busy", { status: inatStatus });
    if (url.includes("attributevalues")) return Response.json(codes);
    if (url.includes("geoserver")) return Response.json(fms);
    return new Response("unexpected", { status: 500 });
  }) as typeof fetch;
  return asked;
}

async function get(path: string): Promise<Response> {
  const route = path.split("?")[0] === "/sources" ? "GET /sources" : path.startsWith("/near") ? "GET /near" : "GET /posts";
  const handler = api.routes[route];
  if (!handler) throw new Error(`the posts API should serve ${route}`);
  return handler(new Request(`http://127.0.0.1/api/posts${path}`) as BunRequest<string>);
}

describe("GET /posts", () => {
  test("an optional source without a key answers 503 'needs_key' and fetches nothing", async () => {
    const asked = fakeUpstreams();
    const failure = await get("/posts?source=youtube&west=12.4&south=41.8&east=12.6&north=42").catch((err: unknown) => err);
    expect(failure).toBeInstanceOf(HttpError);
    expect(failure).toMatchObject({ status: 503, code: "needs_key", message: "Needs a free key: see README" });
    expect(asked).toEqual([]);
  });

  test("rounds the view to the grid once, on the server, and asks iNaturalist for that box", async () => {
    const asked = fakeUpstreams();
    const view = { west: 12.4612, south: 41.8713, east: 12.5398, north: 41.9259 };
    const res = await get(`/posts?source=inaturalist&west=${view.west}&south=${view.south}&east=${view.east}&north=${view.north}&locale=it-IT`);
    const body = (await res.json()) as PostsReply<"inaturalist">;
    expect(body.box).toEqual(snapBox(view));
    const url = new URL(asked[0] ?? "");
    expect([url.searchParams.get("swlng"), url.searchParams.get("swlat"), url.searchParams.get("nelng"), url.searchParams.get("nelat")]).toEqual([
      String(body.box.west),
      String(body.box.south),
      String(body.box.east),
      String(body.box.north),
    ]);
    // Only the language subtag reaches iNaturalist and the cache key.
    expect(url.searchParams.get("locale")).toBe("it");
    expect(body.capped).toBe(true);
  });

  test("street reports outside the Brussels region answer empty without a request", async () => {
    const asked = fakeUpstreams();
    const body = (await (await get("/posts?source=fixmystreet&west=12.4&south=41.8&east=12.6&north=42")).json()) as PostsReply;
    expect(body.posts).toEqual([]);
    expect(asked).toEqual([]);
  });

  test("refuses a locale that is not a language tag", async () => {
    fakeUpstreams();
    await expect(get("/posts?source=inaturalist&west=1&south=1&east=2&north=2&locale=../../etc")).rejects.toMatchObject({ status: 400 });
  });
});

describe("the Briefing counts", () => {
  test("one failing source becomes an error tally and the others still count", async () => {
    fakeUpstreams(500);
    const summary = await near({ lat: 50.8467, lon: 4.3525 }, { locale: "fr", now: Date.now() });
    expect(summary.sightings).toEqual({ ok: false, error: "iNaturalist answered HTTP 500" });
    expect(summary.reports?.ok).toBe(true);
    expect(summary.newest).toBeNull();
    expect(summary.videos).toBeNull();
    expect(summary.photos).toBeNull();
  });

  test("outside Brussels there is no street-report count at all", async () => {
    fakeUpstreams();
    const summary = await near({ lat: 41.9028, lon: 12.4964 }, { locale: "en", now: Date.parse("2026-10-09T07:00:00+02:00") });
    expect(summary.reports).toBeNull();
    expect(summary.sightings).toMatchObject({ ok: true, capped: true });
    expect(summary.newest?.photo).not.toBeNull();
  });
});
