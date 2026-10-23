import { HttpError, defineSource, fetchJson, json, lat, lon, log, memo, parseQuery, z } from "../../server/kit";
import { openEvents } from "./eonet.server";
import { mergeQuakes } from "./merge";
import { emscQuakes, ingvQuakes, type QuakeWindow } from "./quakes.server";
import { seismograph, volcanoSeismographs } from "./seismo.server";
import type { Disaster, DisasterType, EonetEvent, Quake } from "./types";

/**
 * Earthquakes from the US Geological Survey (worldwide), EMSC (Europe and the Mediterranean) and INGV (Italy), merged into
 * one list; the live seismograph; disaster alerts from GDACS (UN and EU); and natural events from NASA EONET.
 */

const UsgsFeature = z.object({
  id: z.string(),
  properties: z.object({
    mag: z.number().nullable(),
    magType: z.string().nullable().optional(),
    place: z.string().nullable(),
    time: z.number(),
    url: z.string(),
    felt: z.number().nullable().optional(),
    mmi: z.number().nullable().optional(),
    tsunami: z.number().optional(),
    alert: z.string().nullable().optional(),
    status: z.string().optional(),
    type: z.string().optional(),
  }),
  geometry: z.object({ coordinates: z.tuple([z.number(), z.number(), z.number()]) }),
});
const UsgsFeed = z.object({ features: z.array(UsgsFeature) });

const FEEDS = { day: "all_day", week: "2.5_week", month: "4.5_month" } as const;

const GdacsFeature = z.object({
  geometry: z.object({ coordinates: z.tuple([z.number(), z.number()]) }),
  properties: z.object({
    eventtype: z.enum(["EQ", "TC", "FL", "VO", "WF", "DR"]),
    eventid: z.number(),
    name: z.string(),
    alertlevel: z.enum(["Green", "Orange", "Red"]),
    fromdate: z.string(),
    todate: z.string(),
    country: z.string().optional(),
    affectedcountries: z.array(z.object({ countryname: z.string() })).optional(),
    severitydata: z.object({ severitytext: z.string() }).optional(),
    url: z.object({ report: z.string() }),
  }),
});
const GdacsFeed = z.object({ features: z.array(GdacsFeature) });

function usgsQuakes(window: QuakeWindow): Promise<Quake[]> {
  return memo(`usgs:${window}`, window === "day" ? 60_000 : 600_000, async (): Promise<Quake[]> => {
    const feed = await fetchJson("USGS", `https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/${FEEDS[window]}.geojson`, UsgsFeed);
    return feed.features
      .filter((f) => f.properties.mag !== null && (f.properties.type ?? "earthquake") === "earthquake")
      .map((f) => ({
        id: f.id,
        mag: f.properties.mag ?? 0,
        magType: f.properties.magType ?? "",
        place: f.properties.place ?? "Unknown location",
        time: f.properties.time,
        lon: f.geometry.coordinates[0],
        lat: f.geometry.coordinates[1],
        depthKm: f.geometry.coordinates[2],
        url: f.properties.url,
        source: "USGS" as const,
        alsoIn: [],
        felt: f.properties.felt ?? null,
        mmi: f.properties.mmi ?? null,
        tsunami: f.properties.tsunami === 1,
        alert: f.properties.alert ?? null,
        reviewed: f.properties.status === "reviewed",
      }));
  });
}

export default defineSource({
  probes: [
    { name: "Earthquakes · USGS", url: "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/significant_hour.geojson" },
    { name: "Earthquakes · EMSC", url: "https://www.seismicportal.eu/fdsnws/event/1/query?format=json&limit=1" },
    { name: "Earthquakes · INGV", url: "https://webservices.ingv.it/fdsnws/event/1/query?format=text&limit=1" },
    { name: "Natural events · NASA EONET", url: "https://eonet.gsfc.nasa.gov/api/v3/events?limit=1" },
    { name: "Disaster alerts · GDACS", url: "https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH?eventlist=TC&alertlevel=red" },
  ],
  routes: {
    "GET /quakes": async (req) => {
      const { window } = parseQuery(req, z.object({ window: z.enum(["day", "week", "month"]).default("day") }));
      // USGS carries the world; EMSC and INGV add the small and fast events in Europe. A regional service that is down
      // must not hide the global one, so the list is built from whatever answered.
      const results = await Promise.allSettled([usgsQuakes(window), emscQuakes(window), ingvQuakes(window)]);
      const lists = results.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
      const failed = results.flatMap((r, i) => (r.status === "rejected" ? [{ service: ["USGS", "EMSC", "INGV"][i], error: r.reason instanceof Error ? r.reason.message : String(r.reason) }] : []));
      for (const f of failed) log.warn("quake service failed", f);
      if (lists.length === 0) {
        const first = results.find((r) => r.status === "rejected");
        throw first?.status === "rejected" ? first.reason : new Error("No quake service answered");
      }
      return json(mergeQuakes(...lists), { maxAge: 30 });
    },

    "GET /seismo": async (req) => {
      const q = parseQuery(req, z.object({ lat, lon, at: z.coerce.number().int().optional() }));
      const now = Date.now();
      // A past window must lie in the last two weeks: networks keep older data in archives that answer slowly or not at all.
      if (q.at !== undefined && (q.at > now || q.at < now - 14 * 86_400_000)) {
        throw new HttpError(400, "bad_query", "Seismograph traces are available for the last 14 days.");
      }
      return json(await seismograph(q.lat, q.lon, q.at ?? null), { maxAge: q.at === undefined ? 10 : 3600 });
    },

    "GET /volcanoes": async (req) => {
      const q = parseQuery(req, z.object({ at: z.coerce.number().int().optional() }));
      const now = Date.now();
      if (q.at !== undefined && (q.at > now || q.at < now - 14 * 86_400_000)) {
        throw new HttpError(400, "bad_query", "Seismograph traces are available for the last 14 days.");
      }
      return json(await volcanoSeismographs(q.at ?? null), { maxAge: q.at === undefined ? 10 : 3600 });
    },

    "GET /events": async (req) => {
      const q = parseQuery(
        req,
        z.object({
          west: z.coerce.number().min(-180).max(180).default(-180),
          south: z.coerce.number().min(-90).max(90).default(-90),
          east: z.coerce.number().min(-180).max(180).default(180),
          north: z.coerce.number().min(-90).max(90).default(90),
          limit: z.coerce.number().int().min(1).max(4000).default(2500),
        }),
      );
      const events = (await openEvents())
        .filter((e) => e.lat >= q.south && e.lat <= q.north && (q.west <= q.east ? e.lon >= q.west && e.lon <= q.east : e.lon >= q.west || e.lon <= q.east))
        .sort((a, b) => Date.parse(b.date) - Date.parse(a.date))
        .slice(0, q.limit);
      return json(events satisfies EonetEvent[], { maxAge: 300 });
    },

    "GET /disasters": async () => {
      const disasters = await memo("gdacs", 10 * 60_000, async (): Promise<Disaster[]> => {
        const from = new Date(Date.now() - 14 * 86_400_000).toISOString().slice(0, 10);
        const url = `https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH?eventlist=EQ,TC,FL,VO,WF,DR&alertlevel=orange;red&fromdate=${from}`;
        const feed = await fetchJson("GDACS", url, GdacsFeed, { timeoutMs: 20_000 });
        const seen = new Set<string>();
        return feed.features.flatMap((f) => {
          const p = f.properties;
          const id = `${p.eventtype}-${p.eventid}`;
          if (seen.has(id)) return [];
          seen.add(id);
          return [
            {
              id,
              type: p.eventtype as DisasterType,
              name: p.name,
              alert: p.alertlevel,
              lon: f.geometry.coordinates[0],
              lat: f.geometry.coordinates[1],
              from: p.fromdate,
              to: p.todate,
              countries: p.affectedcountries?.map((c) => c.countryname).join(", ") || p.country || "",
              severity: p.severitydata?.severitytext ?? "",
              url: p.url.report,
            },
          ];
        });
      });
      return json(disasters, { maxAge: 600 });
    },
  },
});
