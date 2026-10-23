import { HttpError, defineSource, describe, json, lat, lon, parseQuery, z } from "../../server/kit";
import { distanceM, type LatLon } from "../../shared/geo";
import { GRID_CELLS, boxAround, boxesMeet, inBox, snapBox } from "./box";
import { SOURCES, SOURCE_IDS } from "./sources/index.server";
import { NEEDS_KEY, type LoadOptions } from "./sources/source.server";
import type { Box, NearSummary, Post, PostsReply, SourceStatus, Tally } from "./types";

/**
 * The language of species and street names: the primary subtag of a BCP 47 tag ("it-IT" → "it"). Keeping only the
 * subtag keeps the number of cache entries small.
 */
const locale = z
  .string()
  .regex(/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/)
  .transform((tag) => (tag.split("-")[0] ?? "en").toLowerCase())
  .default("en");

const NEAR_M = 10_000;
/** The Briefing asks every few minutes; an hour-old count of live streams is close enough and spares YouTube searches. */
const NEAR_VIDEO_AGE_MS = 60 * 60_000;

/** Count a source's posts near a point; a failure becomes a tally with its message, so one source cannot hide the others. */
async function tally<P extends Post>(load: () => Promise<{ posts: P[]; capped: boolean }>, close: (p: Post) => boolean): Promise<{ tally: Tally; posts: P[] }> {
  try {
    const { posts, capped } = await load();
    const near = posts.filter(close);
    return { tally: { ok: true, count: near.length, capped }, posts: near };
  } catch (err) {
    return { tally: { ok: false, error: describe(err) }, posts: [] };
  }
}

export async function near(here: LatLon, options: LoadOptions): Promise<NearSummary> {
  const area = boxAround(here, NEAR_M);
  const close = (p: Post): boolean => distanceM(here, p) <= NEAR_M;
  const { inaturalist, fixmystreet, youtube, flickr } = SOURCES;
  const inRegion = fixmystreet.area !== null && inBox(fixmystreet.area, here);
  const [sightings, reports, videos, photos] = await Promise.all([
    tally(() => inaturalist.posts(snapBox(area, GRID_CELLS.inaturalist), options), close),
    inRegion ? tally(() => fixmystreet.posts(snapBox(area, GRID_CELLS.fixmystreet), options), close) : null,
    youtube.configured() ? tally(() => youtube.posts(snapBox(area, GRID_CELLS.youtube), { ...options, maxAgeMs: NEAR_VIDEO_AGE_MS }), close) : null,
    flickr.configured() ? tally(() => flickr.posts(snapBox(area, GRID_CELLS.flickr), options), close) : null,
  ]);
  return {
    radiusKm: NEAR_M / 1000,
    sightings: sightings.tally,
    newest: sightings.posts.find((p) => p.photo) ?? null,
    reports: reports?.tally ?? null,
    videos: videos?.tally ?? null,
    photos: photos?.tally ?? null,
  };
}

/** Which sources exist and whether each can answer. Never the keys themselves. */
export function sourceStatuses(): SourceStatus[] {
  return SOURCE_IDS.map((id) => ({ id, label: SOURCES[id].label, configured: SOURCES[id].configured() }));
}

/** Mounted at /api/posts/…: public posts that people made at a place, from several sources, in one shape. */
export default defineSource({
  probes: [
    { name: "Posts · iNaturalist", url: "https://api.inaturalist.org/v2/observations?per_page=0&fields=id" },
    { name: "Posts · Fix My Street Brussels", url: "https://data.mobility.brussels/data/attributevalues/?tid=fims_code_category" },
  ],
  routes: {
    "GET /sources": () => json(sourceStatuses()),

    /** One source's posts in a map area. The browser sends the view as it is; it is rounded to the source's cache grid here, once. */
    "GET /posts": async (req) => {
      const q = parseQuery(req, z.object({ source: z.enum(SOURCE_IDS), west: lon, south: lat, east: lon, north: lat, locale }));
      const source = SOURCES[q.source];
      if (!source.configured()) throw new HttpError(503, "needs_key", NEEDS_KEY);
      const box: Box = snapBox(q, GRID_CELLS[q.source]);
      const empty = source.area !== null && !boxesMeet(box, source.area);
      const { posts, capped } = empty ? { posts: [], capped: false } : await source.posts(box, { locale: q.locale, now: Date.now() });
      return json({ source: q.source, box, posts, capped } satisfies PostsReply);
    },

    /** Counts for the Briefing: posts within 10 km of a point. */
    "GET /near": async (req) => {
      const q = parseQuery(req, z.object({ lat, lon, locale }));
      return json(await near({ lat: q.lat, lon: q.lon }, { locale: q.locale, now: Date.now() }));
    },
  },
});
