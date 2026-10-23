import { HttpError, fetchJson, fetchUpstream, memo, parseUpstream, z } from "../../server/kit";
import type { BirdClip, BirdSpecies, BirdsNear, BirdWindow } from "./types";

/**
 * Birds heard around a place, from BirdWeather's public GraphQL API: small listening stations (mostly
 * in gardens and balconies) run BirdNET and report each call they recognise.
 *
 * The answer names the station that heard each call, with its position, and carries a playable clip. A
 * clip's file name holds its station id, so the browser streams it through an opaque key on this server.
 */

const SOURCE = "BirdWeather";
const ENDPOINT = "https://app.birdweather.com/graphql";
/** Half the height of the search box, in degrees of latitude (about 28 km). */
const HALF_BOX_DEG = 0.25;
const TOP_SPECIES = 6;
/** The API refuses queries with more than three detection fields. */
const CLIP_QUERIES_PER_REQUEST = 3;
const SAMPLE = 20;

/** The grid cell that holds a position, and the box searched around its centre. */
export function searchArea(lat: number, lon: number): { centre: { lat: number; lon: number }; ne: { lat: number; lon: number }; sw: { lat: number; lon: number } } {
  const cell = (v: number): number => Math.round(v * 10) / 10;
  const centre = { lat: cell(lat), lon: cell(lon) };
  // A degree of longitude shrinks towards the poles. Clamp so the box stays sane near them.
  const halfLon = HALF_BOX_DEG / Math.max(0.2, Math.cos((centre.lat * Math.PI) / 180));
  return {
    centre,
    ne: { lat: Math.min(90, centre.lat + HALF_BOX_DEG), lon: Math.min(180, centre.lon + halfLon) },
    sw: { lat: Math.max(-90, centre.lat - HALF_BOX_DEG), lon: Math.max(-180, centre.lon - halfLon) },
  };
}

// ── GraphQL ───────────────────────────────────────────────────────

const Envelope = z.object({ data: z.unknown().optional(), errors: z.array(z.object({ message: z.string() })).optional() });

async function ask<S extends z.ZodType>(query: string, variables: Record<string, unknown>, schema: S): Promise<z.infer<S>> {
  const body = await fetchJson(SOURCE, ENDPOINT, Envelope, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, variables }),
    timeoutMs: 20_000,
  });
  const failure = body.errors?.[0];
  if (failure) throw new HttpError(502, "upstream_error", `${SOURCE} refused the question: ${failure.message}`);
  return parseUpstream(SOURCE, schema, body.data);
}

const Summary = z.object({
  counts: z.object({ detections: z.number(), species: z.number(), stations: z.number() }),
  topSpecies: z.array(z.object({ speciesId: z.string(), count: z.number(), species: z.object({ commonName: z.string(), scientificName: z.string() }) })),
  timeOfDayDetectionCounts: z.array(z.object({ bins: z.array(z.object({ key: z.number(), count: z.number() })) })),
});

const SUMMARY_QUERY = `query($period: InputDuration, $day: InputDuration, $ne: InputLocation, $sw: InputLocation, $limit: Int) {
  counts(period: $period, ne: $ne, sw: $sw) { detections species stations }
  topSpecies(period: $period, ne: $ne, sw: $sw, limit: $limit) { speciesId count species { commonName scientificName } }
  timeOfDayDetectionCounts(period: $day, ne: $ne, sw: $sw) { bins { key count } }
}`;

const Detection = z.object({
  timestamp: z.string(),
  confidence: z.number().nullable(),
  soundscape: z.object({ url: z.string(), startTime: z.number().nullable(), endTime: z.number().nullable() }).nullable(),
  station: z.object({ id: z.string(), name: z.string(), coords: z.object({ lat: z.number(), lon: z.number() }) }).nullable().optional(),
});
export type Detection = z.infer<typeof Detection>;
const Sample = z.object({ nodes: z.array(Detection) });

/** Latest detections of up to three species at once, as aliases a, b and c of one request. */
async function samples(ids: readonly string[], variables: Record<string, unknown>): Promise<Detection[][]> {
  const aliases = ids.map((_, i) => String.fromCharCode(97 + i));
  const query = `query($period: InputDuration, $ne: InputLocation, $sw: InputLocation, ${aliases.map((a) => `$${a}: ID`).join(", ")}) {
  ${aliases.map((a) => `${a}: detections(first: ${SAMPLE}, speciesId: $${a}, period: $period, ne: $ne, sw: $sw) { nodes { timestamp confidence soundscape { url startTime endTime } station { id name coords { lat lon } } } }`).join("\n  ")}
}`;
  const data = await ask(query, { ...variables, ...Object.fromEntries(aliases.map((a, i) => [a, ids[i]])) }, z.record(z.string(), Sample));
  return aliases.map((a) => data[a]?.nodes ?? []);
}

// ── Reading the answers ───────────────────────────────────────────

/** Clips are files on BirdWeather's media server. Anything else in the field is ignored. */
const CLIP_URL = /^https:\/\/media\.birdweather\.com\/soundscapes\/[\w./-]+\.(?:flac|wav|mp3)$/;

/** A call's clip as the server knows it: `url` carries the station id and never goes to the browser. */
export interface PickedClip extends Omit<BirdClip, "key"> {
  url: string;
}

/** The surest call in a sample that has a public clip. Only the few seconds of the call itself are kept. */
export function bestClip(sample: readonly Detection[]): PickedClip | null {
  let best: { clip: PickedClip; confidence: number } | null = null;
  for (const d of sample) {
    const s = d.soundscape;
    const at = Date.parse(d.timestamp);
    if (!s || !CLIP_URL.test(s.url) || Number.isNaN(at)) continue;
    const confidence = d.confidence ?? 0;
    if (best && confidence <= best.confidence) continue;
    const startS = Math.max(0, s.startTime ?? 0);
    const station = d.station ? { id: d.station.id, name: d.station.name, lat: d.station.coords.lat, lon: d.station.coords.lon } : null;
    best = { clip: { url: s.url, startS, endS: Math.max(startS + 1, s.endTime ?? startS + 3), at, station }, confidence };
  }
  return best?.clip ?? null;
}

/** Key to file address, for the clips in answers the browser may still hold. Oldest first, so the map stays small. */
const MAX_KEYS = 300;
const clipUrls = new Map<string, string>();

/** The browser's handle on a clip: a hash of the address, which cannot be turned back into a station id. */
export function publicClip({ url, ...times }: PickedClip): BirdClip {
  const key = new Bun.CryptoHasher("sha256").update(url).digest("hex").slice(0, 24);
  clipUrls.delete(key);
  clipUrls.set(key, url);
  if (clipUrls.size > MAX_KEYS) clipUrls.delete(clipUrls.keys().next().value ?? key);
  return { key, ...times };
}

export function meanCertainty(sample: readonly Detection[]): number | null {
  const values = sample.flatMap((d) => (d.confidence === null ? [] : [d.confidence]));
  return values.length === 0 ? null : values.reduce((sum, v) => sum + v, 0) / values.length;
}

/** Half-hour bins from every species, folded into 24 hours of the day. */
export function hoursOfDay(species: readonly { bins: readonly { key: number; count: number }[] }[]): number[] {
  const hours = new Array<number>(24).fill(0);
  for (const s of species) {
    for (const b of s.bins) {
      const hour = Math.min(23, Math.max(0, Math.floor(b.key)));
      hours[hour] = (hours[hour] ?? 0) + b.count;
    }
  }
  return hours;
}

// ── The route ─────────────────────────────────────────────────────

export function birdsNear(lat: number, lon: number, window: BirdWindow): Promise<BirdsNear> {
  const { centre, ne, sw } = searchArea(lat, lon);
  return memo(`listen:birds:${window}:${centre.lat},${centre.lon}`, 3 * 60_000, async (): Promise<BirdsNear> => {
    const variables = { period: { count: 1, unit: window }, ne, sw };
    const summary = await ask(SUMMARY_QUERY, { ...variables, day: { count: 1, unit: "day" }, limit: TOP_SPECIES }, Summary);

    // Spaced one after the other: three species per request is the most the API allows.
    const ids = summary.topSpecies.map((s) => s.speciesId);
    const found: Detection[][] = [];
    for (let i = 0; i < ids.length; i += CLIP_QUERIES_PER_REQUEST) found.push(...(await samples(ids.slice(i, i + CLIP_QUERIES_PER_REQUEST), variables)));

    const top = summary.topSpecies.map((s, i): BirdSpecies => {
      const clip = bestClip(found[i] ?? []);
      return {
        id: s.speciesId,
        commonName: s.species.commonName,
        scientificName: s.species.scientificName,
        count: s.count,
        certainty: meanCertainty(found[i] ?? []),
        clip: clip && publicClip(clip),
      };
    });
    return {
      window,
      area: { lat: centre.lat, lon: centre.lon, radiusKm: Math.round(HALF_BOX_DEG * 111) },
      detections: summary.counts.detections,
      species: summary.counts.species,
      stations: summary.counts.stations,
      top,
      hours: hoursOfDay(summary.timeOfDayDetectionCounts),
      at: Date.now(),
    };
  });
}

// ── Streaming a clip ──────────────────────────────────────────────

/** A one-minute FLAC is about 200 KB; this leaves room for long WAV files and stops anything else. */
const MAX_CLIP_BYTES = 16_000_000;
const CLIP_TIMEOUT_MS = 60_000;

/** Passes bytes through and fails the stream once more than `limit` have gone by, for a server that sends no length. */
function capped(limit: number): TransformStream<Uint8Array, Uint8Array> {
  let seen = 0;
  return new TransformStream({
    transform(chunk, controller) {
      seen += chunk.length;
      if (seen > limit) controller.error(new HttpError(502, "upstream_shape", `${SOURCE} sent a recording larger than expected`));
      else controller.enqueue(chunk);
    },
  });
}

/**
 * Stream the clip behind a key from BirdWeather's media host. The browser seeks to the call, so `Range` goes
 * through. The upstream request ends when the browser leaves.
 */
export async function streamClip(req: Request, key: string): Promise<Response> {
  const url = clipUrls.get(key);
  if (!url) throw new HttpError(404, "unknown_clip", "This recording is no longer on offer. Reload the birds list.");

  const range = req.headers.get("range");
  const res = await fetchUpstream(SOURCE, url, {
    headers: { accept: "audio/*", ...(range ? { range } : {}) },
    redirect: "error",
    signal: AbortSignal.any([req.signal, AbortSignal.timeout(CLIP_TIMEOUT_MS)]),
  });

  const type = res.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ?? "";
  const length = Number(res.headers.get("content-length") ?? 0);
  if (!res.body || !type.startsWith("audio/") || length > MAX_CLIP_BYTES) {
    await res.body?.cancel();
    throw new HttpError(502, "not_audio", `${SOURCE} did not answer with a recording of a size VANTAGE plays (it sent ${type || "no type"}, ${length} bytes)`);
  }

  const headers = new Headers({ "content-type": type, "cache-control": "private, max-age=600" });
  for (const name of ["content-length", "content-range", "accept-ranges"]) {
    const value = res.headers.get(name);
    if (value) headers.set(name, value);
  }
  return new Response(res.body.pipeThrough(capped(MAX_CLIP_BYTES)), { status: res.status, headers });
}
