import { HttpError, defineSource, json, lat, lon, parseQuery, z } from "../../server/kit";
import { floatProfile, floatsIn } from "./argo.server";
import { alertsNear, gaugesIn, plainGauges, readingOf, withLevels } from "./gauges.server";
import type { ArgoFloat, ArgoProfile, GaugeAlerts, GaugeReading, Gauge } from "./types";

/** Tide gauges (IOC Sea Level Station Monitoring facility, VLIZ and UNESCO/IOC) and Argo ocean floats (Euro-Argo, Ifremer ERDDAP). */

const box = z.object({
  west: z.coerce.number().min(-180).max(180),
  south: z.coerce.number().min(-90).max(90),
  east: z.coerce.number().min(-180).max(180),
  north: z.coerce.number().min(-90).max(90),
});
/** Judging a gauge takes its last 24 hours, so a map view analyses only the gauges nearest its centre. */
const ANALYSED_PER_VIEW = 24;
const MAX_ARGO_SPAN = { lon: 80, lat: 50 };

export default defineSource({
  probes: [
    { name: "Sea level · IOC", url: "https://www.ioc-sealevelmonitoring.org/" },
    { name: "Ocean floats · Argo", url: "https://erddap.ifremer.fr/erddap/tabledap/ArgoFloats.csv?platform_number&platform_number=%221902582%22&cycle_number=260&pres%3C=7" },
  ],
  routes: {
    "GET /gauges": async (req) => {
      const q = parseQuery(req, box.extend({ analyse: z.enum(["0", "1"]).default("0") }));
      const stations = await gaugesIn(q, q.analyse === "1" ? ANALYSED_PER_VIEW : 600);
      const gauges: Gauge[] = q.analyse === "1" ? await withLevels(stations) : plainGauges(stations);
      return json(gauges, { maxAge: 30 });
    },

    "GET /gauge": async (req) => {
      const q = parseQuery(req, z.object({ code: z.string().regex(/^[A-Za-z0-9_-]{2,16}$/) }));
      return json((await readingOf(q.code)) satisfies GaugeReading, { maxAge: 30 });
    },

    "GET /alerts": async (req) => {
      const q = parseQuery(req, z.object({ lat, lon, radiusKm: z.coerce.number().min(10).max(600).default(300) }));
      return json((await alertsNear(q, q.radiusKm)) satisfies GaugeAlerts, { maxAge: 60 });
    },

    "GET /argo": async (req) => {
      const q = parseQuery(req, box);
      if (q.east - q.west > MAX_ARGO_SPAN.lon || q.north - q.south > MAX_ARGO_SPAN.lat || q.east < q.west) {
        throw new HttpError(400, "area_too_large", `Ask for an area at most ${MAX_ARGO_SPAN.lon}° wide and ${MAX_ARGO_SPAN.lat}° tall. Zoom the map in.`);
      }
      return json((await floatsIn(q)) satisfies ArgoFloat[], { maxAge: 300 });
    },

    "GET /argo/profile": async (req) => {
      const q = parseQuery(req, z.object({ platform: z.string() }));
      return json((await floatProfile(q.platform)) satisfies ArgoProfile, { maxAge: 300 });
    },
  },
});
