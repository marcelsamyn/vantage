import { HttpError, fetchJson, fetchUpstream, log, memo, parseUpstream, z } from "../../server/kit";
import type { CreatedNote, MapNote, NewNote, NoteList } from "./types";

const SOURCE = "OpenStreetMap notes";
const REAL_API = "https://api.openstreetmap.org";
const HEADERS = { "user-agent": "VANTAGE/1.0 (personal dashboard; local)" };

/** Tests point this at the OSM developer sandbox, so no test ever writes to the real map. */
const api = (): string => process.env.VANTAGE_OSM_API ?? REAL_API;
const webBase = (): string => (api() === REAL_API ? "https://www.openstreetmap.org" : api());
const noteUrl = (id: number): string => `${webBase()}/note/${id}`;

const stamp = (s: string): number => Date.parse(s.replace(" UTC", "Z").replace(" ", "T"));

const noteFeature = z.object({
  geometry: z.object({ coordinates: z.tuple([z.number(), z.number()]) }),
  properties: z.object({
    id: z.number(),
    date_created: z.string(),
    status: z.enum(["open", "closed", "hidden"]),
    comments: z.array(z.object({ date: z.string(), action: z.enum(["opened", "commented", "closed", "reopened", "hidden"]), text: z.string() })),
  }),
});
const noteCollection = z.object({ features: z.array(noteFeature) });

function toNote(f: z.infer<typeof noteFeature>): MapNote {
  const [lon, lat] = f.geometry.coordinates;
  return {
    id: f.properties.id,
    lat,
    lon,
    status: f.properties.status,
    createdAt: stamp(f.properties.date_created),
    // Commenters have user names. The notes screen speaks of "a mapper", so the names never leave the server.
    comments: f.properties.comments.map((c) => ({ at: stamp(c.date), action: c.action, text: c.text.replace(/\B@[\w.-]+/g, "a mapper").slice(0, 700) })),
    url: noteUrl(f.properties.id),
  };
}

export interface Box {
  west: number;
  south: number;
  east: number;
  north: number;
}

/** Open notes, and notes closed within the last week, inside a box. OSM refuses boxes larger than 25 square degrees. */
export function notesIn(b: Box): Promise<NoteList> {
  if ((b.east - b.west) * (b.north - b.south) > 20) throw new HttpError(400, "bbox_too_large", "Zoom in to see map notes: OpenStreetMap lists notes for areas up to about 4 by 5 degrees.");
  const key = `reach-notes:${api()}:${[b.west, b.south, b.east, b.north].map((v) => v.toFixed(2)).join(",")}`;
  return memo(key, 60_000, async () => {
    const url = new URL("/api/0.6/notes.json", api());
    url.search = new URLSearchParams({ bbox: `${b.west},${b.south},${b.east},${b.north}`, closed: "7", limit: "100" }).toString();
    const data = await fetchJson(SOURCE, url, noteCollection, { headers: HEADERS });
    return { fetchedAt: Date.now(), notes: data.features.map(toNote) } satisfies NoteList;
  });
}

let lastPost = 0;

/** Anonymous notes are allowed. The route has already validated the position and text. */
export async function createNote(n: NewNote): Promise<CreatedNote> {
  const now = Date.now();
  // The dialog confirms once; this stops a double click or a stuck key from posting twice.
  if (now - lastPost < 15_000) throw new HttpError(429, "too_fast", "A note was sent a moment ago. Wait 15 seconds before sending another.");
  lastPost = now;
  const res = await fetchUpstream(SOURCE, new URL("/api/0.6/notes.json", api()), {
    method: "POST",
    headers: { ...HEADERS, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ lat: String(n.lat), lon: String(n.lon), text: n.text }),
  }).catch((err: unknown) => {
    lastPost = 0;
    throw err;
  });
  const created = parseUpstream(SOURCE, noteFeature, await res.json());
  log.info("map note created", { id: created.properties.id, api: api() });
  return { id: created.properties.id, url: noteUrl(created.properties.id) };
}
