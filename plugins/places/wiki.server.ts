import { fetchJson, memo, z } from "../../server/kit";

/** Wikipedia lookups: articles near a point, and a short summary of one article. */

const GeoPages = z.object({
  query: z
    .object({
      pages: z.array(
        z.object({
          pageid: z.number(),
          title: z.string(),
          coordinates: z.array(z.object({ lat: z.number(), lon: z.number() })).optional(),
          thumbnail: z.object({ source: z.string() }).optional(),
          description: z.string().optional(),
        }),
      ),
    })
    .optional(),
});

export interface WikiPin {
  id: number;
  title: string;
  lat: number;
  lon: number;
  description: string | null;
  thumbnail: string | null;
}

export function articlesNear(lat: number, lon: number, radiusM: number, limit: number, lang = "en"): Promise<WikiPin[]> {
  const url = new URL(`https://${lang}.wikipedia.org/w/api.php`);
  for (const [k, v] of Object.entries({
    action: "query",
    generator: "geosearch",
    ggscoord: `${lat}|${lon}`,
    ggsradius: String(Math.min(10_000, Math.round(radiusM))),
    ggslimit: String(limit),
    prop: "coordinates|pageimages|description",
    piprop: "thumbnail",
    pithumbsize: "200",
    format: "json",
    formatversion: "2",
  }))
    url.searchParams.set(k, v);
  return memo(`wiki:near:${url}`, 3_600_000, async () => {
    const data = await fetchJson("Wikipedia", url, GeoPages);
    return (data.query?.pages ?? []).flatMap((p) => {
      const c = p.coordinates?.[0];
      return c ? [{ id: p.pageid, title: p.title, lat: c.lat, lon: c.lon, description: p.description ?? null, thumbnail: p.thumbnail?.source ?? null }] : [];
    });
  });
}

const Summary = z.object({
  title: z.string(),
  extract: z.string().default(""),
  description: z.string().optional(),
  thumbnail: z.object({ source: z.string() }).optional(),
  content_urls: z.object({ desktop: z.object({ page: z.string() }) }),
});

export interface WikiSummary {
  title: string;
  extract: string;
  description: string | null;
  thumbnail: string | null;
  url: string;
}

export function summary(title: string, lang = "en"): Promise<WikiSummary> {
  const url = `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, "_"))}`;
  return memo(`wiki:summary:${url}`, 86_400_000, async () => {
    const d = await fetchJson("Wikipedia", url, Summary);
    return { title: d.title, extract: d.extract, description: d.description ?? null, thumbnail: d.thumbnail?.source ?? null, url: d.content_urls.desktop.page };
  });
}
