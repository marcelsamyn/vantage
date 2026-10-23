import { HttpError, defineSource, json, lat, lon, ndjson, parseQuery, z } from "../../server/kit";
import { bridgeFeed } from "./bridges.server";
import { counterDetail, counters } from "./counters.server";
import { signalDetail, signalHeads, signalStream, MAX_HEADS } from "./hamburg.server";
import { matrixSigns } from "./matrix.server";
import { nearest } from "./nearest.server";
import { carParks } from "./parking.server";
import { riverGauges, riverSeries } from "./rivers.server";
import type { CounterFeed, RiverFeed } from "./types";

const bbox = z.object({
  west: z.coerce.number().min(-180).max(180),
  south: z.coerce.number().min(-90).max(90),
  east: z.coerce.number().min(-180).max(180),
  north: z.coerce.number().min(-90).max(90),
});

const IdList = z
  .string()
  .regex(/^\d+(,\d+)*$/, "ids must be comma-separated numbers")
  .transform((s) => s.split(",").map(Number));

export default defineSource({
  probes: [{ name: "Traffic lights · Hamburg SensorThings", url: "https://tld.iot.hamburg.de/v1.1/" }],
  routes: {
    "GET /signals": async (req) => {
      const q = parseQuery(req, bbox.extend({ routes: z.enum(["0", "1"]).default("0") }));
      if (q.east - q.west > 0.2 || q.north - q.south > 0.12) throw new HttpError(400, "view_too_large", "Zoom in to see live traffic lights");
      return json(await signalHeads(q, q.routes === "1"));
    },

    "GET /signals/stream": (req) => {
      const q = parseQuery(req, z.object({ ids: IdList, transport: z.enum(["mqtt", "poll"]).default("mqtt") }));
      if (q.ids.length === 0 || q.ids.length > MAX_HEADS * 2) throw new HttpError(400, "bad_ids", `Follow between 1 and ${MAX_HEADS * 2} signals at a time`);
      return ndjson(signalStream(q.ids, req.signal, q.transport === "poll"));
    },

    "GET /signal": async (req) => {
      const q = parseQuery(req, z.object({ thing: z.coerce.number().int().positive() }));
      return json(await signalDetail(q.thing));
    },

    "GET /rivers": async (req) => {
      const q = parseQuery(req, bbox);
      if (q.east - q.west > 1.2 || q.north - q.south > 0.9) throw new HttpError(400, "view_too_large", "Zoom in to see river gauges");
      return json(await riverGauges(q) satisfies RiverFeed);
    },

    "GET /river": async (req) => {
      const q = parseQuery(req, z.object({ id: z.string().regex(/^(waterinfo|hubeau|arpa):[\w.-]+$/, "Gauge ids look like waterinfo:L10_077") }));
      return json(await riverSeries(q.id));
    },

    "GET /matrix": async (req) => {
      const q = parseQuery(req, bbox);
      if (q.east - q.west > 1.2 || q.north - q.south > 0.9) throw new HttpError(400, "view_too_large", "Zoom in to see motorway signs");
      return json(await matrixSigns(q));
    },

    "GET /nearest": async (req) => {
      const q = parseQuery(req, z.object({ lat, lon }));
      return json(await nearest(q));
    },

    "GET /bridges": async () => json(await bridgeFeed()),

    "GET /parking": async () => json(await carParks()),

    "GET /counters": async () => json({ counters: await counters() } satisfies CounterFeed),

    "GET /counter": async (req) => {
      const q = parseQuery(req, z.object({ id: z.string().regex(/^(brussels|ghent):[\w-]+$/, "Counter ids look like brussels:CB1101") }));
      return json(await counterDetail(q.id));
    },
  },
});
