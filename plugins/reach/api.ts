import { defineSource, json, lat, lon, parseBody, parseQuery, z } from "../../server/kit";
import { landGrid } from "./land.server";
import { ordersNear, reportLink } from "./orders.server";
import { createNote, notesIn } from "./osm.server";
import { embeddable, receivers } from "./receivers.server";
import { stationDetail, stationList } from "./satnogs.server";
import { NOTE_MAX } from "./types";

const place = z.object({ lat, lon });

const newNote = z.object({
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  text: z
    .string()
    .min(1)
    .max(NOTE_MAX)
    .refine((t) => t.trim().length > 0, "The note is empty"),
});

/**
 * Mounted at /api/reach/…
 * Everything here is something the public is meant to operate or influence: radio receivers, satellite ground
 * stations, reports to a city, and map notes. The only write is POST /notes, which the browser sends after the user
 * confirms the exact text.
 */
export default defineSource({
  probes: [
    { name: "Reach · SatNOGS", url: "https://network.satnogs.org/api/" },
    { name: "Reach · OpenStreetMap notes", url: "https://api.openstreetmap.org/api/0.6/notes.json?bbox=0,0,0.01,0.01&limit=1" },
  ],
  routes: {
    "GET /receivers": async () => json(await receivers()),
    "GET /embeddable": async (req) => json(await embeddable(parseQuery(req, z.object({ id: z.string().min(1).max(64) })).id)),
    "GET /stations": async () => json(await stationList()),
    "GET /station": async (req) => {
      const { id } = parseQuery(req, z.object({ id: z.coerce.number().int().positive() }));
      return json(await stationDetail(id));
    },
    "GET /orders": async (req) => {
      const { lat: la, lon: lo, radiusKm } = parseQuery(req, z.object({ lat, lon, radiusKm: z.coerce.number().min(0.5).max(25).default(8) }));
      return json(await ordersNear({ lat: la, lon: lo }, radiusKm * 1000));
    },
    "GET /report-link": async (req) => json(await reportLink(parseQuery(req, place))),
    "GET /notes": async (req) => {
      const box = parseQuery(req, z.object({ west: lon, south: lat, east: lon, north: lat }));
      return json(await notesIn(box));
    },
    "POST /notes": async (req) => json(await createNote(await parseBody(req, newNote))),
    "GET /land": async () => json(await landGrid(), { maxAge: 86_400 }),
  },
});
