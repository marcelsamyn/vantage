import { HttpError, describe, diskMemo, fetchJson, log, memo, z } from "../../server/kit";
import { compassPoint } from "../../shared/geo";
import { overpass, positionOf, type OsmElement } from "../grid/overpass.server";
import { directionBearing } from "./direction";
import { DAY, USER_AGENT, webcam, type Operator } from "./camera.server";
import { platformOf, resolveLinks, webLink, type LinkedPicture } from "./links.server";
import type { Circle, SearchedProvider } from "./providers.server";
import { StoredStream } from "./traffic.server";
import type { Webcam } from "./types";

/**
 * Directories that collect cameras from many owners and answer for one area at a time. They fill the places no
 * road operator covers: a town square, a harbour, a ski slope.
 */

const WORLD: SearchedProvider["bbox"] = [-90, -180, 90, 180];

// ── Windy.com webcams ─────────────────────────────────────────────

export const WINDY_KEY = "VANTAGE_WINDY_WEBCAM_KEY";
const windyKey = (): string | null => process.env[WINDY_KEY]?.trim() || null;

const WINDY: Operator = { provider: "windy", providerName: "Windy.com", kind: "view", license: "Webcams provided by Windy.com", refreshS: 300 };
/** Windy answers at most 50 cameras, nearest first, within 250 km. */
const WINDY_LIMIT = 50;
const WINDY_MAX_KM = 250;
/** The free tier's picture addresses stop working after ten minutes, so the list is asked again by then. */
const WINDY_TTL_MS = 9 * 60_000;
/** A slow answer holds up the whole wall; past this, the last good answer stands in. */
const WINDY_TIMEOUT_MS = 6_000;

const WindyAnswer = z.object({
  webcams: z.array(
    z.object({
      webcamId: z.number(),
      status: z.string(),
      title: z.string(),
      lastUpdatedOn: z.string().nullish(),
      categories: z.array(z.object({ id: z.string() })).default([]),
      images: z.object({ current: z.object({ preview: z.string() }) }).nullish(),
      location: z.object({ latitude: z.number(), longitude: z.number() }),
      urls: z.object({ detail: z.string() }).nullish(),
    }),
  ),
});
export type WindyAnswer = z.infer<typeof WindyAnswer>;

/** Titles read "Place › Direction: Label", and either part after the place can be missing. */
const WINDY_TITLE = /^(.*?)(?: › ([^:]+))?(?:: (.+))?$/;

export function windyCameras(answer: WindyAnswer): Webcam[] {
  return answer.webcams.flatMap((w) => {
    if (w.status !== "active" || !w.images) return [];
    const [, place = w.title, direction, label] = w.title.match(WINDY_TITLE) ?? [];
    const updated = w.lastUpdatedOn ? Date.parse(w.lastUpdatedOn) : Number.NaN;
    return webcam(WINDY, {
      id: String(w.webcamId),
      name: label ? `${place} · ${label}` : place,
      lat: w.location.latitude,
      lon: w.location.longitude,
      image: w.images.current.preview,
      kind: w.categories.some((c) => c.id === "traffic") ? "traffic" : "view",
      direction: direction?.toLowerCase() ?? null,
      capturedAt: Number.isFinite(updated) ? updated : null,
      page: w.urls?.detail ?? null,
    });
  });
}

const windy: SearchedProvider = {
  id: "windy",
  name: "Windy.com",
  bbox: WORLD,
  configured: () => windyKey() !== null,
  search: async (around) => {
    const key = windyKey();
    if (!key) throw new HttpError(503, "needs_key", `Needs a free Windy key in ${WINDY_KEY}: see README`);
    // Rounding the centre to about a kilometre lets nearby questions share one answer; the extra kilometre covers the shift.
    const lat = around.lat.toFixed(2);
    const lon = around.lon.toFixed(2);
    const km = Math.min(WINDY_MAX_KM, Math.ceil(around.radiusM / 1000) + 1);
    return memo(`webcams-windy-${lat},${lon},${km}`, WINDY_TTL_MS, async () => {
      const url = new URL("https://api.windy.com/webcams/api/v3/webcams");
      url.search = new URLSearchParams({ nearby: `${lat},${lon},${km}`, limit: String(WINDY_LIMIT), include: "categories,images,location,urls" }).toString();
      return windyCameras(await fetchJson("Windy webcams", url, WindyAnswer, { timeoutMs: WINDY_TIMEOUT_MS, headers: { "user-agent": USER_AGENT, "x-windy-api-key": key } }));
    });
  },
};

// ── OpenStreetMap ─────────────────────────────────────────────────

/** Most `contact:webcam` tags link to a web page; only those that end in a picture can be shown. */
const PICTURE_PATH = /\.(jpe?g|png|gif|webp)$/i;
/** Archived copies show one moment, not the camera. */
const FROZEN_HOSTS = new Set(["web.archive.org"]);
const TILE_DEG = 1;
/** Enough one-degree tiles for a circle of about 150 km; the nearest tiles come first. */
const MAX_TILES = 12;
const M_PER_DEG = 111_320;
const OSM_WAIT_MS = 5_000;
const LINKS_GRACE_MS = 300;
/**
 * Overpass serves two queries at a time to everything in VANTAGE, so camera tiles may hold only a few places in its
 * queue. A tile turned away is asked again a minute later, when `memo` lets the key retry.
 */
const MAX_TILE_LOADS = 4;
const TILES_BUSY = "tiles_busy";
let tileLoads = 0;

async function loadTile(s: number, w: number): Promise<OsmElement[]> {
  if (tileLoads >= MAX_TILE_LOADS) throw new HttpError(503, TILES_BUSY, "OpenStreetMap is still loading nearby areas");
  tileLoads++;
  try {
    return await overpass(`nwr["contact:webcam"](${s},${w},${s + TILE_DEG},${w + TILE_DEG});out tags center;`);
  } finally {
    tileLoads--;
  }
}

/** The tag's addresses in order; mappers separate several with ";" and sometimes leave out the scheme. */
const linksIn = (tag: string | undefined): string[] => (tag?.split(";") ?? []).flatMap((value) => webLink(value) ?? []);

function isPicture(link: string): boolean {
  const { hostname, pathname } = new URL(link);
  return PICTURE_PATH.test(pathname) && !FROZEN_HOSTS.has(hostname);
}

/** Links to camera pages that need reading: those of cameras without a direct picture. */
export function pageLinks(elements: readonly OsmElement[]): string[] {
  return elements.flatMap((el) => {
    const links = linksIn(el.tags["contact:webcam"]);
    return links.some(isPicture) ? [] : links;
  });
}

/** OSM writes the direction as degrees or as a compass point. */
function facing(tag: string | undefined): string | null {
  if (!tag) return null;
  const degrees = Number(tag);
  return Number.isFinite(degrees) ? compassPoint(degrees) : tag;
}

/** Cameras from mapped elements: a direct picture, or the live picture found behind a page link. */
export function osmCameras(elements: readonly OsmElement[], pictures: Readonly<Record<string, LinkedPicture>> = {}): Webcam[] {
  return elements.flatMap((el) => {
    const at = positionOf(el);
    const links = linksIn(el.tags["contact:webcam"]);
    const direct = links.find(isPicture);
    const page = direct ? undefined : links.find((link) => pictures[link]);
    const found = page ? pictures[page] : undefined;
    const image = direct ?? found?.image;
    if (!image || !at) return [];
    const source = found ?? platformOf(new URL(image));
    const owner = el.tags.operator ?? source.platform;
    const kind = el.tags["surveillance:zone"] === "traffic" ? "traffic" : "view";
    const credit = owner === source.platform ? owner : `${owner} on ${source.platform}`;
    const op: Operator = { provider: "osm", providerName: owner, kind, license: `Camera mapped by OpenStreetMap contributors (ODbL). Picture: ${credit}`, refreshS: source.refreshS };
    return webcam(op, {
      id: `${el.type}/${el.id}`,
      name: el.tags.name ?? el.tags.description ?? found?.title ?? `Camera of ${owner}`,
      ...at,
      image,
      stream: found?.stream ?? null,
      direction: facing(el.tags["camera:direction"] ?? el.tags.direction),
      bearing: directionBearing(el.tags["camera:direction"] ?? el.tags.direction),
      // A page link leads to the camera's own page, which is where its platform asks viewers to go.
      page: page ?? `https://www.openstreetmap.org/${el.type}/${el.id}`,
    });
  });
}

/** Both tile caches live on disk for a day, so what is read back is checked against the fields the code expects. */
const StoredElements = z.array(
  z.object({
    type: z.enum(["node", "way", "relation"]),
    id: z.number(),
    lat: z.number().optional(),
    lon: z.number().optional(),
    center: z.object({ lat: z.number(), lon: z.number() }).optional(),
    geometry: z.array(z.object({ lat: z.number(), lon: z.number() }).nullable()).optional(),
    tags: z.record(z.string(), z.string()),
  }),
);
const StoredPictures = z.record(
  z.string(),
  z.object({ image: z.string(), stream: StoredStream.nullable(), platform: z.string(), title: z.string().nullable(), refreshS: z.number() }),
);

/** Read a tile's page links once a day. Reading a busy tile takes minutes, so callers do not wait for it. */
function readLinks(s: number, w: number, elements: readonly OsmElement[], into: Record<string, LinkedPicture>): Promise<void> {
  return diskMemo(`webcams-osm-links-${s},${w}`, DAY, () => resolveLinks(pageLinks(elements)), StoredPictures).then(
    (found) => void Object.assign(into, found),
    (err: unknown) => log.warn("webcam page links not kept", { tile: `${s},${w}`, error: describe(err) }),
  );
}

/** South-west corners of the one-degree tiles that a circle touches, nearest first. */
export function tilesAround(around: Circle): { s: number; w: number }[] {
  const dLat = around.radiusM / M_PER_DEG;
  const dLon = around.radiusM / (M_PER_DEG * Math.max(0.1, Math.cos((around.lat * Math.PI) / 180)));
  const tiles: { s: number; w: number; d: number }[] = [];
  for (let s = Math.floor(Math.max(-90, around.lat - dLat)); s < Math.min(90, around.lat + dLat); s += TILE_DEG) {
    for (let w = Math.floor(around.lon - dLon); w < around.lon + dLon; w += TILE_DEG) {
      tiles.push({ s, w: ((((w + 180) % 360) + 360) % 360) - 180, d: Math.hypot(s + 0.5 - around.lat, w + 0.5 - around.lon) });
    }
  }
  return tiles
    .sort((a, b) => a.d - b.d)
    .slice(0, MAX_TILES)
    .map(({ s, w }) => ({ s, w }));
}

const openStreetMap: SearchedProvider = {
  id: "osm",
  name: "OpenStreetMap",
  bbox: WORLD,
  configured: () => true,
  search: async (around) => {
    const ready: OsmElement[][] = [];
    const errors: unknown[] = [];
    const pictures: Record<string, LinkedPicture> = {};
    const linkReads: Promise<void>[] = [];
    // Tiles keep the cache independent of where exactly you stand; mapped cameras change slowly.
    const tiles = tilesAround(around).map(({ s, w }) =>
      diskMemo(`webcams-osm-${s},${w}`, DAY, () => loadTile(s, w), StoredElements).then(
        (elements) => {
          ready.push(elements);
          linkReads.push(readLinks(s, w, elements, pictures));
        },
        (err: unknown) => {
          if (!(err instanceof HttpError && err.code === TILES_BUSY)) errors.push(err);
        },
      ),
    );
    // Overpass serves two queries at a time, so a new area takes minutes. Answer with the tiles ready in time;
    // the others keep loading into the cache for the next question.
    await Promise.race([Promise.all(tiles), Bun.sleep(OSM_WAIT_MS)]);
    // Page links already read come from the cache within moments; links still being read join a later answer.
    await Promise.race([Promise.all(linkReads), Bun.sleep(LINKS_GRACE_MS)]);
    // Fail only when Overpass itself failed and nothing is ready; tiles still waiting their turn are not a failure.
    if (ready.length === 0 && errors.length > 0) throw errors[0];
    return osmCameras(ready.flat(), pictures);
  },
};

export const directoryProviders: SearchedProvider[] = [windy, openStreetMap];
