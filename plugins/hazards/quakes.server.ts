import { HttpError, fetchJson, fetchUpstream, memo, z } from "../../server/kit";
import type { Quake } from "./types";

/**
 * Regional earthquake services that report smaller and faster than the global USGS feed:
 * EMSC (Euro-Mediterranean Seismological Centre, a clearing house for European agencies) and INGV (Italy's national institute).
 */

export type QuakeWindow = "day" | "week" | "month";

const WINDOW_MS: Record<QuakeWindow, number> = { day: 86_400_000, week: 7 * 86_400_000, month: 30 * 86_400_000 };

const EmscFeed = z.object({
  features: z.array(
    z.object({
      properties: z.object({
        unid: z.string(),
        time: z.string(),
        mag: z.number(),
        magtype: z.string().optional(),
        flynn_region: z.string().optional(),
        lat: z.number(),
        lon: z.number(),
        depth: z.number(),
        evtype: z.string().optional(),
      }),
    }),
  ),
});

/** Euro-Mediterranean box, where EMSC's contributors are the local agencies and a M1 event is worth showing. */
const EURO_MED = "minlatitude=25&maxlatitude=72&minlongitude=-32&maxlongitude=50";

export function emscQuakes(window: QuakeWindow): Promise<Quake[]> {
  return memo(`emsc:${window}`, window === "day" ? 30_000 : 60_000, async () => {
    const start = new Date(Date.now() - WINDOW_MS[window]).toISOString().slice(0, 19);
    const minMag = window === "month" ? 2 : 1;
    const url = `https://www.seismicportal.eu/fdsnws/event/1/query?format=json&${EURO_MED}&minmag=${minMag}&starttime=${start}&orderby=time&limit=5000`;
    const feed = await fetchJson("EMSC", url, EmscFeed, { timeoutMs: 25_000 });
    return feed.features
      .filter((f) => (f.properties.evtype ?? "ke") === "ke")
      .map(({ properties: p }): Quake => ({
        id: `emsc:${p.unid}`,
        mag: p.mag,
        magType: p.magtype ?? "",
        place: titleCase(p.flynn_region ?? "Unknown region"),
        time: Date.parse(p.time),
        lat: p.lat,
        lon: p.lon,
        depthKm: Math.abs(p.depth),
        url: `https://www.seismicportal.eu/eventdetails.html?unid=${encodeURIComponent(p.unid)}`,
        source: "EMSC",
        alsoIn: [],
        felt: null,
        mmi: null,
        tsunami: false,
        alert: null,
        reviewed: null,
      }));
  });
}

/** EMSC writes regions in capitals ("STRAIT OF GIBRALTAR"). */
const titleCase = (s: string): string => s.toLowerCase().replace(/(^|[\s(-])([a-z])/g, (_, lead: string, c: string) => lead + c.toUpperCase());

export function ingvQuakes(window: QuakeWindow): Promise<Quake[]> {
  return memo(`ingv:${window}`, window === "day" ? 30_000 : 60_000, async () => {
    const start = new Date(Date.now() - WINDOW_MS[window]).toISOString().slice(0, 19);
    const minMag = window === "month" ? 1 : -1;
    const res = await fetchUpstream("INGV", `https://webservices.ingv.it/fdsnws/event/1/query?format=text&starttime=${start}&minmag=${minMag}&orderby=time&limit=3000`, { timeoutMs: 25_000 });
    return parseIngvText(await res.text());
  });
}

/** INGV's text format: `#EventID|Time|Latitude|Longitude|Depth/Km|Author|Catalog|Contributor|ContributorID|MagType|Magnitude|MagAuthor|EventLocationName|EventType`. */
export function parseIngvText(text: string): Quake[] {
  const quakes: Quake[] = [];
  for (const line of text.split("\n")) {
    if (!line || line.startsWith("#")) continue;
    const f = line.split("|");
    if (f.length < 14) throw new HttpError(502, "upstream_shape", "INGV sent a line with fewer fields than its header promises");
    const [id, time, lat, lon, depth, author, , , , magType, mag, , place, type] = f;
    if (type !== "earthquake" || !id) continue;
    const q = { mag: Number(mag), lat: Number(lat), lon: Number(lon), depth: Number(depth), time: Date.parse(`${time}Z`) };
    if (![q.mag, q.lat, q.lon, q.depth, q.time].every(Number.isFinite) || mag === "") continue;
    quakes.push({
      id: `ingv:${id}`,
      mag: q.mag,
      magType: magType ?? "",
      place: place ?? "Italy",
      time: q.time,
      lat: q.lat,
      lon: q.lon,
      depthKm: q.depth,
      url: `https://terremoti.ingv.it/event/${encodeURIComponent(id)}`,
      source: "INGV",
      alsoIn: [],
      felt: null,
      mmi: null,
      tsunami: false,
      alert: null,
      // INGV marks automatic locations in the author field.
      reviewed: author ? !/auto/i.test(author) : null,
    });
  }
  return quakes;
}
