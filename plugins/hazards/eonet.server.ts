import { fetchJson, memo, webUrl, z } from "../../server/kit";
import type { EonetCategory, EonetEvent } from "./types";

/** NASA EONET: natural events that satellites and agencies track, such as wildfires, storms, volcanoes and drifting icebergs. */

const CATEGORIES = ["wildfires", "severeStorms", "volcanoes", "seaLakeIce", "floods", "dustHaze", "drought", "landslides", "snow", "tempExtremes", "waterColor", "manmade", "earthquakes"] as const satisfies readonly EonetCategory[];

const Geometry = z.object({
  date: z.string(),
  type: z.string(),
  coordinates: z.unknown(),
  magnitudeValue: z.number().nullable().optional(),
  magnitudeUnit: z.string().nullable().optional(),
});

const Feed = z.object({
  events: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      link: z.string(),
      categories: z.array(z.object({ id: z.string(), title: z.string() })),
      sources: z.array(z.object({ id: z.string(), url: z.string() })).default([]),
      geometry: z.array(Geometry),
    }),
  ),
});

const isCategory = (id: string): id is EonetCategory => (CATEGORIES as readonly string[]).includes(id);

/** A GeoJSON position, or the centre of the first ring of a polygon. */
function centre(type: string, coordinates: unknown): [number, number] | null {
  const pair = (c: unknown): [number, number] | null => (Array.isArray(c) && typeof c[0] === "number" && typeof c[1] === "number" ? [c[0], c[1]] : null);
  if (type === "Point") return pair(coordinates);
  if (type !== "Polygon" || !Array.isArray(coordinates) || !Array.isArray(coordinates[0])) return null;
  const ring = (coordinates[0] as unknown[]).map(pair).filter((p): p is [number, number] => p !== null);
  if (ring.length === 0) return null;
  return [ring.reduce((s, p) => s + p[0], 0) / ring.length, ring.reduce((s, p) => s + p[1], 0) / ring.length];
}

/** The browser opens these links, so only web addresses pass; a `javascript:` address in a feed becomes nothing. */

const MAX_TRACK = 16;
/** Categories whose position changes between fixes. A fire's later fixes are its growing outline, not a path. */
const MOVING = new Set<EonetCategory>(["severeStorms", "seaLakeIce", "dustHaze", "floods"]);
/** EONET keeps events "open" long after the last report (a wildfire from July 2024 was still listed). Past this many days without a new fix an event is dropped. */
const MAX_AGE_DAYS: Partial<Record<EonetCategory, number>> = { wildfires: 30, severeStorms: 14, volcanoes: 180, seaLakeIce: 120 };
const DEFAULT_MAX_AGE_DAYS = 60;

/** Every open event, reduced to its latest position, size and recent track. NASA updates the list a few times per day. */
export function openEvents(): Promise<EonetEvent[]> {
  return memo("eonet:open", 30 * 60_000, async () => {
    const feed = await fetchJson("NASA EONET", "https://eonet.gsfc.nasa.gov/api/v3/events?status=open", Feed, { timeoutMs: 40_000 });
    const out: EonetEvent[] = [];
    for (const e of feed.events) {
      const category = e.categories[0];
      if (!category || !isCategory(category.id)) continue;
      const fixes = e.geometry
        .map((g) => ({ g, at: centre(g.type, g.coordinates) }))
        .filter((f): f is { g: z.infer<typeof Geometry>; at: [number, number] } => f.at !== null)
        .sort((a, b) => Date.parse(a.g.date) - Date.parse(b.g.date));
      const latest = fixes[fixes.length - 1];
      // Some wildfires (one named for a ranch in Kansas, for example) sit at exactly 15°E 30°N in the Libyan desert: a placeholder, not their position.
      if (!latest || (latest.at[0] === 15 && latest.at[1] === 30)) continue;
      if (Date.now() - Date.parse(latest.g.date) > (MAX_AGE_DAYS[category.id] ?? DEFAULT_MAX_AGE_DAYS) * 86_400_000) continue;
      out.push({
        id: e.id,
        title: e.title,
        category: category.id,
        categoryTitle: category.title,
        lon: latest.at[0],
        lat: latest.at[1],
        date: latest.g.date,
        magnitude: latest.g.magnitudeValue != null && latest.g.magnitudeUnit ? { value: latest.g.magnitudeValue, unit: latest.g.magnitudeUnit } : null,
        track: fixes.length > 1 && MOVING.has(category.id) ? fixes.slice(-MAX_TRACK).map((f) => f.at) : [],
        link: webUrl(e.link) ?? `https://eonet.gsfc.nasa.gov/api/v3/events/${encodeURIComponent(e.id)}`,
        sources: e.sources.filter((s) => webUrl(s.url)).slice(0, 4),
      });
    }
    return out;
  });
}
