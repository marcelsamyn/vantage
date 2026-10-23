import { defineSource, diskMemo, json, parseQuery, webUrl, z } from "../../server/kit";
import { evseIds, ifoptIds, uicIds, wikidataIds } from "../../shared/thing-ids";
import { overpass, positionOf, type OsmElement } from "./overpass.server";
import { GRID_KINDS, type GridFeature, type GridKind, type GridTile } from "./types";

/**
 * City infrastructure from OpenStreetMap, served in fixed zoom-14 map tiles (about 2 km across) so
 * neighbouring requests share cache entries and Overpass sees as few queries as possible.
 */

const TILE_ZOOM = 14;

function tileBounds(x: number, y: number, z: number): { s: number; w: number; n: number; e: number } {
  const n2 = 2 ** z;
  const lon = (tx: number): number => (tx / n2) * 360 - 180;
  const lat = (ty: number): number => (Math.atan(Math.sinh(Math.PI * (1 - (2 * ty) / n2))) * 180) / Math.PI;
  return { w: lon(x), e: lon(x + 1), n: lat(y), s: lat(y + 1) };
}

/** Tiles are kept on disk for a day, so what is read back is checked against the fields the code expects. */
const StoredGridTile = z.object({
  z: z.number(),
  x: z.number(),
  y: z.number(),
  fetchedAt: z.number(),
  features: z.array(
    z.object({
      type: z.literal("Feature"),
      properties: z.object({
        kind: z.enum(GRID_KINDS),
        osm: z.string(),
        name: z.string().nullable(),
        tags: z.record(z.string(), z.string()),
        web: z.string().nullable(),
        directions: z.array(z.number()),
        // A tile kept from before codes were read has none; it is read again within a day.
        ids: z.array(z.templateLiteral([z.string(), ":", z.string()])).default([]),
      }),
      geometry: z.union([
        z.object({ type: z.literal("Point"), coordinates: z.array(z.number()) }),
        z.object({ type: z.literal("LineString"), coordinates: z.array(z.array(z.number())) }),
      ]),
    }),
  ),
});

const POINT_QUERIES = [
  'node["man_made"="surveillance"]',
  'node["highway"="traffic_signals"]',
  'nwr["internet_access"~"^(wlan|wifi|yes)$"]["internet_access:fee"!~"^(yes|customers)$"]',
  'node["man_made"~"^(mast|tower)$"]["tower:type"="communication"]',
  'nwr["man_made"="communications_tower"]',
  'nwr["power"="substation"]',
  'nwr["amenity"~"^(police|fire_station|hospital)$"]',
  'node["emergency"="defibrillator"]',
  'node["amenity"="drinking_water"]',
  'nwr["amenity"="toilets"]',
  'nwr["amenity"="charging_station"]',
  'nwr["railway"="station"]',
  'way["bridge:movable"]',
  'way["bridge"="movable"]',
];

/** Which grid kind an element belongs to, or null if none. Order matters: a hospital with Wi-Fi is a hospital. */
function classify(t: Record<string, string>): GridKind | null {
  if (t.man_made === "surveillance") return "camera";
  if (t.highway === "traffic_signals") return "signal";
  if (t.emergency === "defibrillator") return "aed";
  if (t.amenity === "police") return "police";
  if (t.amenity === "fire_station") return "fire";
  if (t.amenity === "hospital") return "hospital";
  if (t.power === "substation") return "substation";
  if (t.power === "line" || t.power === "minor_line") return "powerline";
  if (t.man_made === "communications_tower" || t["tower:type"] === "communication") return "tower";
  if (t.amenity === "drinking_water") return "water";
  if (t.amenity === "toilets") return "toilets";
  if (t.amenity === "charging_station") return "ev";
  if (t.railway === "station") return "station";
  if (t["bridge:movable"] || t.bridge === "movable") return "bridge";
  if (t.internet_access) return "wifi";
  return null;
}

const CARDINAL: Record<string, number> = { N: 0, NNE: 22.5, NE: 45, ENE: 67.5, E: 90, ESE: 112.5, SE: 135, SSE: 157.5, S: 180, SSW: 202.5, SW: 225, WSW: 247.5, W: 270, WNW: 292.5, NW: 315, NNW: 337.5 };

function directions(t: Record<string, string>): number[] {
  const raw = (t["camera:direction"] ?? t.direction ?? "").toUpperCase();
  return raw
    .split(/[;,]/)
    .map((part) => part.trim())
    .map((part) => {
      const n = Number.parseFloat(part);
      return Number.isFinite(n) ? ((n % 360) + 360) % 360 : (CARDINAL[part] ?? null);
    })
    .filter((d): d is number => d !== null);
}

/** Keep the tags a person would want to read; drop internal bookkeeping such as source and note fields. */
function readableTags(t: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(t)) {
    if (/^(source|note|fixme|check_date|created_by|survey|ref:|wikidata|wikipedia|image|mapillary)/.test(k)) continue;
    out[k] = v;
  }
  return out;
}

function toFeature(el: OsmElement): GridFeature | null {
  const kind = classify(el.tags);
  if (!kind) return null;
  const props = {
    kind,
    osm: `${el.type}/${el.id}`,
    name: el.tags["name:en"] ?? el.tags.name ?? null,
    tags: readableTags(el.tags),
    // A tag holds whatever a mapper typed, and the browser may open this one, so only plain http(s) gets through.
    web: webUrl(el.tags.website ?? el.tags["contact:website"] ?? el.tags.url),
    directions: kind === "camera" ? directions(el.tags) : [],
    ids: [...wikidataIds(el.tags.wikidata), ...uicIds(el.tags.uic_ref), ...ifoptIds(el.tags["ref:IFOPT"]), ...evseIds(el.tags["ref:EU:EVSE"])],
  };
  if (kind === "powerline") {
    const coords = (el.geometry ?? []).filter((p): p is { lat: number; lon: number } => p !== null).map((p) => [p.lon, p.lat]);
    return coords.length > 1 ? { type: "Feature", properties: props, geometry: { type: "LineString", coordinates: coords } } : null;
  }
  const pos = positionOf(el);
  return pos ? { type: "Feature", properties: props, geometry: { type: "Point", coordinates: [pos.lon, pos.lat] } } : null;
}

export default defineSource({
  probes: [{ name: "Street grid · OpenStreetMap (Overpass)", url: "https://overpass-api.de/api/status" }],
  routes: {
    "GET /tile": async (req) => {
      const q = parseQuery(req, z.object({ x: z.coerce.number().int().min(0), y: z.coerce.number().int().min(0) }));
      const tile = await diskMemo(`grid-${TILE_ZOOM}-${q.x}-${q.y}`, 24 * 3_600_000, async (): Promise<GridTile> => {
        const b = tileBounds(q.x, q.y, TILE_ZOOM);
        const bbox = `(${b.s},${b.w},${b.n},${b.e})`;
        const points = POINT_QUERIES.map((p) => `${p}${bbox};`).join("");
        const elements = await overpass(`(${points});out center tags;way["power"~"^(line|minor_line)$"]${bbox};out geom tags;`, 40);
        const seen = new Set<string>();
        const features: GridFeature[] = [];
        for (const el of elements) {
          const key = `${el.type}/${el.id}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const f = toFeature(el);
          if (f) features.push(f);
        }
        return { z: TILE_ZOOM, x: q.x, y: q.y, fetchedAt: Date.now(), features };
      }, StoredGridTile);
      return json(tile, { maxAge: 3600 });
    },
  },
});
