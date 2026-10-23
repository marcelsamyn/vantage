import { defineSource, json, lat, lon, parseQuery, z } from "../../server/kit";
import type { Article, ArticleSummary } from "./types";
import { articlesNear, summary } from "./wiki.server";

/** Wikipedia articles that have coordinates: the stories behind the buildings around you. */
export default defineSource({
  probes: [{ name: "Places · Wikipedia", url: "https://en.wikipedia.org/w/api.php?action=query&meta=siteinfo&format=json" }],
  routes: {
    "GET /near": async (req) => {
      const q = parseQuery(req, z.object({ lat, lon, radiusM: z.coerce.number().min(100).max(10_000).default(3000) }));
      // Snap the centre so panning a little reuses the same cached answer.
      const la = Math.round(q.lat * 200) / 200;
      const lo = Math.round(q.lon * 200) / 200;
      const pins = await articlesNear(la, lo, Math.ceil(q.radiusM / 500) * 500, 60);
      return json(pins satisfies Article[], { maxAge: 3600 });
    },
    "GET /summary": async (req) => {
      const q = parseQuery(req, z.object({ title: z.string().min(1).max(300) }));
      return json((await summary(q.title)) satisfies ArticleSummary, { maxAge: 86_400 });
    },
  },
});
