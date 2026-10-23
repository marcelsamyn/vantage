import { HttpError, describe, diskMemo, fetchJson, fetchPublic, fetchUpstream, log, memo, webUrl, z } from "../../server/kit";
import type { HlsPlaylist, Microphone, Microphones } from "./types";

/**
 * Open microphones that people leave streaming on purpose:
 *  - Locustream (Locus Sonus, an art-and-research group): volunteers' microphones, listed by the Soundmap itself.
 *  - Orcasound: hydrophones in the Salish Sea, streamed live for anyone to listen in (CC BY-NC-SA 4.0).
 */

const LOCUS_LIST = "https://locusonus.org/soundmap/list/active/json/name";
const LOCUS_HOME = "https://locusonus.org/soundmap/";
const ORCA_FEEDS = "https://live.orcasound.net/api/json/feeds";
const ORCA_HOME = "https://live.orcasound.net/";
const HOUR_MS = 3_600_000;

// ── Locustream ────────────────────────────────────────────────────

const RawLocus = z.object({
  id: z.string().regex(/^\d+$/),
  name: z.string(),
  url: z.string(),
  ext: z.enum(["mp3", "ogg"]),
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  country: z.string().nullish(),
});
type RawLocus = z.infer<typeof RawLocus>;

/** The Soundmap writes country names in the language and spelling of each streamer. */
const COUNTRY_ALIASES: Readonly<Record<string, string>> = {
  uk: "United Kingdom",
  schweiz: "Switzerland",
  suisse: "Switzerland",
  "unites states": "United States",
  polska: "Poland",
  catalunya: "Catalonia",
};

/** Words that stay lower case inside a place name ("Usti nad Labem"). */
const SMALL_WORDS = new Set(["nad", "de", "la", "le", "du", "der", "den", "am", "im", "an", "of", "on", "upon"]);

const capitalise = (text: string): string => (text === "" ? text : text.charAt(0).toUpperCase() + text.slice(1));
const titleCase = (text: string): string =>
  text
    .split(/\s+/)
    .map((word, i) => (i > 0 && SMALL_WORDS.has(word) ? word : capitalise(word)))
    .join(" ");

export function normaliseCountry(raw: string | null | undefined): string | null {
  const text = raw?.trim().toLowerCase();
  if (!text) return null;
  return COUNTRY_ALIASES[text] ?? titleCase(text);
}

/** "bruxelles — rue de la poudrière" is place and spot, joined by an em dash. */
export function splitName(raw: string): { place: string; name: string } {
  const [place, ...rest] = raw.split("—").map((part) => part.trim().replace(/\s+/g, " "));
  const spot = rest.join(" — ");
  if (!place) return { place: raw.trim(), name: raw.trim() };
  return spot === "" || spot === place.toLowerCase() ? { place: titleCase(place), name: titleCase(place) } : { place: titleCase(place), name: capitalise(spot) };
}

function toMicrophone(raw: RawLocus): Microphone | null {
  const url = webUrl(raw.url);
  // A position of exactly 0°, 0° is a streamer who never set one.
  if (!url || (raw.lat === 0 && raw.lng === 0)) return null;
  const { place, name } = splitName(raw.name);
  return { id: `ls-${raw.id}`, source: "locustream", name, place, country: normaliseCountry(raw.country), lat: raw.lat, lon: raw.lng, timezone: null, format: raw.ext, stream: url, live: true, homepage: LOCUS_HOME };
}

/** The Soundmap lists only streams that are on right now, so an old copy would show a stopped stream as live. */
function locusList(): Promise<RawLocus[]> {
  return diskMemo("listen-locustream", 10 * 60_000, async () => {
    const all = await fetchJson("Locus Sonus Soundmap", LOCUS_LIST, z.array(z.unknown()));
    // One streamer's malformed entry must not hide the other microphones.
    return all.flatMap((item) => {
      const parsed = RawLocus.safeParse(item);
      return parsed.success ? [parsed.data] : [];
    });
  }, z.array(RawLocus));
}

// ── Orcasound ─────────────────────────────────────────────────────

const OrcaFeeds = z.object({
  data: z.array(
    z.object({
      attributes: z.object({
        name: z.string(),
        slug: z.string().regex(/^[a-z0-9-]+$/),
        node_name: z.string().regex(/^[a-z0-9_]+$/),
        bucket: z.string().regex(/^[a-z0-9.-]+$/),
        visible: z.boolean(),
        lat_lng: z.object({ lat: z.number(), lng: z.number() }),
      }),
    }),
  ),
});
type OrcaNode = z.infer<typeof OrcaFeeds>["data"][number]["attributes"];

/** A hydrophone is live when its playlist changed within this long. Segments are ten seconds. */
const LIVE_WITHIN_MS = 3 * 60_000;

function orcaNodes(): Promise<OrcaNode[]> {
  return diskMemo("listen-orcasound", 6 * HOUR_MS, async () => {
    const feeds = await fetchJson("Orcasound", ORCA_FEEDS, OrcaFeeds);
    return feeds.data.map((feed) => feed.attributes).filter((node) => node.visible);
  }, z.array(OrcaFeeds.shape.data.element.shape.attributes));
}

const round4 = (v: number): number => Math.round(v * 1e4) / 1e4;
const orcaId = (node: OrcaNode): string => `oc-${node.slug}`;

/** The playlist folder is named after the moment the hydrophone last restarted. `latest.txt` holds that name. */
async function orcaPlaylist(node: OrcaNode): Promise<{ url: string; modified: number }> {
  const base = `https://${node.bucket}.s3.amazonaws.com/${node.node_name}`;
  const folder = (await (await fetchUpstream("Orcasound", `${base}/latest.txt`, { timeoutMs: 8000 })).text()).trim();
  if (!/^\d+$/.test(folder)) throw new HttpError(502, "upstream_shape", "Orcasound sent an unexpected playlist folder name");
  const url = `${base}/hls/${folder}/live.m3u8`;
  const head = await fetchUpstream("Orcasound", url, { method: "HEAD", timeoutMs: 8000 });
  const modified = Date.parse(head.headers.get("last-modified") ?? "");
  return { url, modified: Number.isNaN(modified) ? 0 : modified };
}

async function orcaMicrophones(): Promise<Microphone[]> {
  const nodes = await orcaNodes();
  return Promise.all(
    nodes.map(async (node): Promise<Microphone> => {
      const live = await orcaPlaylist(node)
        .then((p) => Date.now() - p.modified < LIVE_WITHIN_MS)
        .catch(() => false);
      return { id: orcaId(node), source: "orcasound", name: "Underwater microphone", place: node.name, country: null, lat: round4(node.lat_lng.lat), lon: round4(node.lat_lng.lng), timezone: null, format: "hls", stream: null, live, homepage: ORCA_HOME };
    }),
  );
}

// ── Time zones ────────────────────────────────────────────────────

const Zone = z.object({ timezone: z.string() });
/** Open-Meteo answers one place with an object and several places with an array. */
const Zones = z.union([z.array(Zone), Zone.transform((zone) => [zone])]);

const ZONE_TTL_MS = 30 * 24 * HOUR_MS;

/** A time zone belongs to a place, so a microphone is remembered by its position (to about 1 km), not by the list it came in. */
export const zoneKey = (mic: Pick<Microphone, "lat" | "lon">): string => `listen-zone-${mic.lat.toFixed(2)}_${mic.lon.toFixed(2)}`;

interface Unknown {
  mic: Microphone;
  resolve: (zone: string) => void;
  reject: (reason: unknown) => void;
}

/** One request names the zones of the places the disk cache does not know yet. */
async function askZones(unknown: readonly Unknown[]): Promise<void> {
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${unknown.map((u) => u.mic.lat).join(",")}&longitude=${unknown.map((u) => u.mic.lon).join(",")}&timezone=auto&forecast_days=1&current=is_day`;
    const zones = await fetchJson("Open-Meteo", url, Zones);
    if (zones.length !== unknown.length) throw new HttpError(502, "upstream_shape", `Open-Meteo named ${zones.length} time zones for ${unknown.length} places`);
    zones.forEach((zone, i) => unknown[i]?.resolve(zone.timezone));
  } catch (err) {
    for (const u of unknown) u.reject(err);
  }
}

/**
 * The time zone of each microphone, so the browser can show the local time there. Zones are cached per position:
 * a change to the list asks only about the new places, and a failed request still returns the zones already known.
 */
export async function zonesFor(mics: readonly Microphone[]): Promise<Map<string, string>> {
  const places = new Map<string, Microphone>();
  for (const mic of mics) places.set(zoneKey(mic), mic);

  const unknown = new Map<string, Unknown>();
  const lookups = [...places].map(([key, mic]) => {
    const asked = Promise.withResolvers<void>();
    const zone = diskMemo(key, ZONE_TTL_MS, () => {
      asked.resolve();
      return new Promise<string>((resolve, reject) => unknown.set(key, { mic, resolve, reject }));
    }, z.string());
    // A lookup is ready once the cache answered or handed its question over to the batch.
    return { key, zone, ready: Promise.race([asked.promise, zone.catch(() => undefined)]) };
  });
  await Promise.all(lookups.map((l) => l.ready));
  if (unknown.size > 0) await askZones([...unknown.values()]);

  const zoneOf = new Map<string, string>();
  const failures: unknown[] = [];
  for (const [i, result] of (await Promise.allSettled(lookups.map((l) => l.zone))).entries()) {
    const key = lookups[i]?.key;
    if (result.status === "rejected") failures.push(result.reason);
    else if (key) zoneOf.set(key, result.value);
  }
  if (failures.length > 0) log.warn("Time zone lookup failed", { places: failures.length, error: describe(failures[0]) });
  return new Map(
    mics.flatMap((mic) => {
      const zone = zoneOf.get(zoneKey(mic));
      return zone ? [[mic.id, zone] as const] : [];
    }),
  );
}

// ── The list ──────────────────────────────────────────────────────

/** An optional part of the answer: when it fails the rest still shows, and the log says why. */
async function optional<T>(what: string, fallback: T, load: () => Promise<T>): Promise<T> {
  try {
    return await load();
  } catch (err) {
    log.warn(`${what} failed`, { error: describe(err) });
    return fallback;
  }
}

/** Locustream first (alphabetical, as the Soundmap lists them), then the hydrophones. */
export function microphones(): Promise<Microphones> {
  return memo("listen:mics", 2 * 60_000, async () => {
    const [locus, orca] = await Promise.all([locusList(), optional("Orcasound list", [], orcaMicrophones)]);
    const mics = [...locus.map(toMicrophone).filter((m): m is Microphone => m !== null), ...orca];
    const zones = await optional("Time zone lookup", new Map<string, string>(), () => zonesFor(mics));
    return {
      microphones: mics.map((m) => ({ ...m, timezone: zones.get(m.id) ?? null })),
      sources: [
        { id: "locustream", name: "Locustream by Locus Sonus", url: LOCUS_HOME, licence: "Open microphones run by volunteers; credit Locus Sonus" },
        { id: "orcasound", name: "Orcasound", url: ORCA_HOME, licence: "CC BY-NC-SA 4.0" },
      ],
    } satisfies Microphones;
  });
}

// ── Playing ───────────────────────────────────────────────────────

/** Only audio is relayed: the stream address comes from a public list that volunteers edit. */
const AUDIO_TYPE = /^(audio\/[\w.+-]+|application\/ogg)$/;

function audioType(header: string | null, fallback: string): string {
  const type = (header ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  if (type === "audio/aacp") return "audio/aac";
  return type === "" ? fallback : type;
}

/**
 * Relay a Locustream microphone through this server. The browser uses it when a stream lacks the
 * cross-origin headers that Web Audio needs to analyse it, and for http:// streams.
 */
export async function relayStream(req: Request, id: string): Promise<Response> {
  const mic = (await microphones()).microphones.find((m) => m.id === id);
  if (!mic?.stream) throw new HttpError(404, "unknown_microphone", "This microphone is not in the Locustream list, so it cannot be relayed");

  const label = `${mic.place} microphone`;
  const upstream = new AbortController();
  req.signal.addEventListener("abort", () => upstream.abort(), { once: true });
  // The browser may have left while the list loaded, before there was a listener to hear it.
  if (req.signal.aborted) return new Response(null, { status: 499 });
  // Only the connection attempt is timed: a live stream is meant to stay open.
  const connecting = setTimeout(() => upstream.abort(), 10_000);
  let res: Response;
  try {
    res = await fetchPublic(label, mic.stream, { headers: { accept: "*/*" }, signal: upstream.signal });
  } finally {
    clearTimeout(connecting);
  }

  const type = audioType(res.headers.get("content-type"), mic.format === "ogg" ? "application/ogg" : "audio/mpeg");
  if (!res.body || !AUDIO_TYPE.test(type)) {
    await res.body?.cancel();
    throw new HttpError(502, "not_audio", `The ${label} did not answer with audio (it sent ${type}). It may be offline.`);
  }
  return new Response(res.body, { headers: { "content-type": type, "cache-control": "no-store" } });
}

/** The current playlist address for an Orcasound hydrophone. */
export async function hlsPlaylist(id: string): Promise<HlsPlaylist> {
  const node = (await orcaNodes()).find((n) => orcaId(n) === id);
  if (!node) throw new HttpError(404, "unknown_microphone", "This is not an Orcasound hydrophone VANTAGE knows");
  const { url, modified } = await memo(`listen:hls:${id}`, 30_000, () => orcaPlaylist(node));
  const idleMin = Math.round((Date.now() - modified) / 60_000);
  if (idleMin * 60_000 > LIVE_WITHIN_MS) {
    const idle = idleMin < 120 ? `has not sent audio for ${idleMin} minutes` : "is offline";
    throw new HttpError(409, "offline", `The ${node.name} hydrophone ${idle}. Pick another microphone.`);
  }
  return { url };
}
