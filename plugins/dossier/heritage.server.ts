import { diskMemo, fetchJson, z } from "../../server/kit";
import { distanceM, type LatLon } from "../../shared/geo";
import { LOOKUP_MARGIN_M, cellAround, distanceToPathM, inBrussels, inFlanders, inItaly, insideRing } from "./area.server";
import { ARCO_SOURCE, arcoNear } from "./arco.server";
import type { Heritage, HeritageEntry } from "./types";

/** The heritage record for a spot: Italy's ArCo catalogue, Flanders' inventory, or the City of Brussels' Grand-Place file. */

const DAY_MS = 24 * 3_600_000;
const WEEK_MS = 7 * DAY_MS;

// ── Flanders ────────────────────────────────────────────────────

const WFS = "https://geo.onroerenderfgoed.be/geoserver/wfs";
const INVENTORY = "https://inventaris.onroerenderfgoed.be/erfgoedobjecten";
const FLANDERS_SOURCE = "Inventaris Onroerend Erfgoed";

type Ring = [number, number][];
const RingSchema = z.array(z.tuple([z.number(), z.number()]));
const WfsResponse = z.object({
  features: z.array(
    z.object({
      geometry: z.union([
        z.object({ type: z.literal("Polygon"), coordinates: z.array(RingSchema) }),
        z.object({ type: z.literal("MultiPolygon"), coordinates: z.array(z.array(RingSchema)) }),
        z.object({ type: z.literal("Point"), coordinates: z.tuple([z.number(), z.number()]) }),
      ]),
      properties: z.object({ erfgoed_id: z.number() }),
    }),
  ),
});

const StoredShape = z.object({ id: z.number(), rings: z.array(RingSchema) });

interface FlemishShape {
  id: number;
  rings: Ring[];
}

function ringsOf(g: z.infer<typeof WfsResponse>["features"][number]["geometry"]): Ring[] {
  if (g.type === "Point") return [[g.coordinates]];
  if (g.type === "Polygon") return g.coordinates;
  return g.coordinates.flat();
}

async function flemishShapes(at: LatLon, radiusM: number): Promise<FlemishShape[]> {
  const cell = cellAround(at, Math.max(radiusM, LOOKUP_MARGIN_M));
  return diskMemo(`dossier-onroerend-${cell.key}`, DAY_MS, async () => {
    const url = new URL(WFS);
    url.search = new URLSearchParams({
      service: "WFS",
      version: "2.0.0",
      request: "GetFeature",
      typeNames: "vioe_geoportaal:bouwkundig_element",
      outputFormat: "application/json",
      srsName: "EPSG:4326",
      // A dense old town holds several hundred inventory shapes per cell; ask for ids and outlines only.
      count: "1500",
      propertyName: "erfgoed_id,geom",
      bbox: `${cell.south.toFixed(6)},${cell.west.toFixed(6)},${cell.north.toFixed(6)},${cell.east.toFixed(6)},urn:ogc:def:crs:EPSG::4326`,
    }).toString();
    const data = await fetchJson("Onroerend Erfgoed (WFS)", url, WfsResponse, { timeoutMs: 25_000 });
    return data.features.map((f) => ({ id: f.properties.erfgoed_id, rings: ringsOf(f.geometry) }));
  }, z.array(StoredShape));
}

const Thesaurus = z.object({ label: z.string(), kenmerk: z.object({ naam: z.string() }) });
const InventoryRecord = z.object({
  id: z.number(),
  naam: z.string().nullable().optional(),
  locatie_samenvatting: z.string().nullable().optional(),
  kenmerkgroepen: z.array(z.object({ thesaurus: z.array(Thesaurus).default([]) })).default([]),
});

async function flemishRecord(id: number): Promise<z.infer<typeof InventoryRecord>> {
  return diskMemo(`dossier-onroerend-record-${id}`, WEEK_MS, () =>
    // Without this header the inventory answers HTML. Only the fields parsed above are kept, so owners and authors of its texts never leave the server.
    fetchJson(FLANDERS_SOURCE, `${INVENTORY}/${id}`, InventoryRecord, { headers: { accept: "application/json" }, timeoutMs: 15_000 }),
    InventoryRecord,
  );
}

function distanceToShape(at: LatLon, shape: FlemishShape): number {
  if (shape.rings.some((ring) => ring.length > 3 && insideRing(at, ring))) return 0;
  return Math.min(...shape.rings.map((ring) => distanceToPathM(at, ring)));
}

async function flemishHeritage(at: LatLon, radiusM: number, limit: number): Promise<HeritageEntry[]> {
  const shapes = await flemishShapes(at, radiusM);
  const near = shapes
    .map((shape) => ({ shape, d: distanceToShape(at, shape) }))
    .filter(({ d }) => d <= radiusM)
    .sort((a, b) => a.d - b.d)
    .slice(0, limit);
  return Promise.all(
    near.map(async ({ shape, d }): Promise<HeritageEntry> => {
      const record = await flemishRecord(shape.id);
      const terms = record.kenmerkgroepen.flatMap((g) => g.thesaurus);
      const labels = (kind: string): string[] => [...new Set(terms.filter((t) => t.kenmerk.naam === kind).map((t) => t.label))];
      return {
        id: String(shape.id),
        title: record.naam ?? record.locatie_samenvatting ?? `Erfgoedobject ${shape.id}`,
        kind: labels("typologie").slice(0, 2).join(", ") || null,
        period: labels("datering").join(" – ") || null,
        author: null,
        // The inventory's free text names owners, residents and builders too often for any filter to catch, so only the title, type and period leave the server.
        note: null,
        distanceM: Math.round(d),
        url: `https://inventaris.onroerenderfgoed.be/erfgoedobjecten/${shape.id}`,
      };
    }),
  );
}

// ── Brussels Grand-Place ────────────────────────────────────────

const BRUSSELS_API = "https://opendata.brussels.be/api/explore/v2.1/catalog/datasets/description-des-batiments-de-la-grand-place/records?limit=100";
const BRUSSELS_SOURCE = "City of Brussels open data · Grand-Place buildings";
const BRUSSELS_PAGE = "https://opendata.brussels.be/explore/dataset/description-des-batiments-de-la-grand-place/table/";

const GrandPlace = z.object({
  results: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      adresse: z.string().nullable().optional(),
      original_main_function: z.string().nullable().optional(),
      protection_measures: z.string().nullable().optional(),
      did_you_know: z.string().nullable().optional(),
      geo_point: z.object({ lat: z.number(), lon: z.number() }),
    }),
  ),
});

const StoredGrandPlace = z.array(
  z.object({
    id: z.string(),
    name: z.string(),
    address: z.string().nullable(),
    function: z.string().nullable(),
    protection: z.string().nullable(),
    didYouKnow: z.string().nullable(),
    lat: z.number(),
    lon: z.number(),
  }),
);

export interface GrandPlaceBuilding {
  id: string;
  name: string;
  address: string | null;
  function: string | null;
  protection: string | null;
  didYouKnow: string | null;
  lat: number;
  lon: number;
}

export function grandPlaceBuildings(): Promise<GrandPlaceBuilding[]> {
  return diskMemo("dossier-grand-place", DAY_MS, async () => {
    const data = await fetchJson(BRUSSELS_SOURCE, BRUSSELS_API, GrandPlace);
    return data.results.map((b) => ({
      id: b.id,
      name: b.name,
      address: b.adresse ?? null,
      function: b.original_main_function ?? null,
      protection: b.protection_measures ?? null,
      didYouKnow: b.did_you_know ?? null,
      lat: b.geo_point.lat,
      lon: b.geo_point.lon,
    }));
  }, StoredGrandPlace);
}

async function brusselsHeritage(at: LatLon, radiusM: number, limit: number): Promise<HeritageEntry[]> {
  const buildings = await grandPlaceBuildings();
  return buildings
    .map((b) => ({ b, d: distanceM(at, b) }))
    .filter(({ d }) => d <= radiusM)
    .sort((a, b) => a.d - b.d)
    .slice(0, limit)
    .map(({ b, d }) => ({
      id: b.id,
      title: b.name,
      kind: "Grand-Place building",
      period: null,
      author: null,
      note: [b.function, b.protection].filter((s): s is string => Boolean(s)).map((s) => (/[.!?]$/.test(s.trim()) ? s.trim() : `${s.trim()}.`)).join(" ") || null,
      distanceM: Math.round(d),
      url: `${BRUSSELS_PAGE}?q=id%3D${encodeURIComponent(b.id)}`,
    }));
}

// ── Entry point ─────────────────────────────────────────────────

/** The nearest heritage entries within `radiusM`, or null where no register covers the spot. */
export async function heritageNear(at: LatLon, radiusM: number, limit: number): Promise<Heritage | null> {
  if (inItaly(at)) return { source: ARCO_SOURCE, entries: await arcoNear(at, radiusM, limit) };
  if (inFlanders(at)) return { source: FLANDERS_SOURCE, entries: await flemishHeritage(at, radiusM, limit) };
  if (inBrussels(at)) return { source: BRUSSELS_SOURCE, entries: await brusselsHeritage(at, radiusM, limit) };
  return null;
}
