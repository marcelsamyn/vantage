import { diskMemo, fetchJson, z } from "../../server/kit";
import { inArea } from "../../shared/geo";

/**
 * Outlines for MeteoAlarm areas. MeteoAlarm's own geometry service needs a token, but its feeds name each
 * area with a NUTS code (Europe's statistical regions) or a MeteoAlarm id. Eurostat's GISCO publishes the
 * NUTS outlines openly: https://gisco-services.ec.europa.eu/distribution/v2/nuts/ (© EuroGeographics for the administrative boundaries).
 */

const GISCO = "https://gisco-services.ec.europa.eu/distribution/v2/nuts/geojson";

type Outline = GeoJSON.Polygon | GeoJSON.MultiPolygon;

const OutlineShape = z.union([z.object({ type: z.literal("Polygon"), coordinates: z.array(z.array(z.tuple([z.number(), z.number()]))) }), z.object({ type: z.literal("MultiPolygon"), coordinates: z.array(z.array(z.array(z.tuple([z.number(), z.number()])))) })]);

/** What the disk cache holds: a GeoJSON position is a number array of any length, so it is read back as one. */
export const StoredOutline = z.union([
  z.object({ type: z.literal("Polygon"), coordinates: z.array(z.array(z.array(z.number()))) }),
  z.object({ type: z.literal("MultiPolygon"), coordinates: z.array(z.array(z.array(z.array(z.number())))) }),
]);

const Level = z.object({
  features: z.array(
    z.object({
      properties: z.object({ NUTS_ID: z.string() }),
      geometry: OutlineShape,
    }),
  ),
});

const round = (n: number): number => Math.round(n * 1000) / 1000;
/** Vertices closer than this (about 250 m) add bytes, not shape, at the zoom levels where warning areas are read. */
const MIN_STEP_DEG = 0.0025;

/** Round a ring to about 100 m and drop vertices that crowd the one before. Rings stay closed. */
export function thinRing(ring: readonly (readonly number[])[]): [number, number][] {
  const kept: [number, number][] = [];
  for (const [x = 0, y = 0] of ring) {
    const last = kept[kept.length - 1];
    if (!last || Math.abs(x - last[0]) >= MIN_STEP_DEG || Math.abs(y - last[1]) >= MIN_STEP_DEG) kept.push([round(x), round(y)]);
  }
  const first = kept[0];
  if (first && kept.length > 1) kept[kept.length - 1] = first;
  return kept.length >= 4 ? kept : ring.map(([x = 0, y = 0]) => [round(x), round(y)]);
}

export function thinOutline(g: Outline): Outline {
  return g.type === "Polygon" ? { type: "Polygon", coordinates: g.coordinates.map(thinRing) } : { type: "MultiPolygon", coordinates: g.coordinates.map((poly) => poly.map(thinRing)) };
}

/** NUTS level 2 (regions) and level 3 (provinces) at 1:10 million, which is sharp enough for a country-sized map. */
export async function nutsOutlines(): Promise<Record<string, Outline>> {
  return diskMemo("weather-nuts-2021", 14 * 86_400_000, async () => {
    const out: Record<string, Outline> = {};
    for (const level of [2, 3]) {
      const data = await fetchJson("Eurostat GISCO regions", `${GISCO}/NUTS_RG_10M_2021_4326_LEVL_${level}.geojson`, Level, { timeoutMs: 60_000 });
      for (const f of data.features) out[f.properties.NUTS_ID] = thinOutline(f.geometry);
    }
    return out;
  }, z.record(z.string(), StoredOutline));
}

/**
 * Italy names its areas by region with ids IT001–IT020. Trentino-Alto Adige is two NUTS regions.
 * The ids and names come from the MeteoAlarm Italy feed.
 */
export const ITALY_REGIONS: Record<string, readonly string[]> = {
  IT001: ["ITF6"], // Calabria
  IT002: ["ITH1", "ITH2"], // Trentino-Alto Adige
  IT003: ["ITC4"], // Lombardia
  IT004: ["ITC2"], // Valle d'Aosta
  IT005: ["ITC1"], // Piemonte
  IT006: ["ITH3"], // Veneto
  IT007: ["ITC3"], // Liguria
  IT008: ["ITH5"], // Emilia-Romagna
  IT009: ["ITI1"], // Toscana
  IT010: ["ITI2"], // Umbria
  IT011: ["ITI3"], // Marche
  IT012: ["ITI4"], // Lazio
  IT013: ["ITF1"], // Abruzzo
  IT014: ["ITF2"], // Molise
  IT015: ["ITF4"], // Puglia
  IT016: ["ITF3"], // Campania
  IT017: ["ITF5"], // Basilicata
  IT018: ["ITG1"], // Sicilia
  IT019: ["ITG2"], // Sardegna
  IT020: ["ITH4"], // Friuli-Venezia Giulia
};

export function joinOutlines(parts: Outline[]): Outline | null {
  const first = parts[0];
  if (!first) return null;
  if (parts.length === 1) return first;
  return { type: "MultiPolygon", coordinates: parts.flatMap((g) => (g.type === "Polygon" ? [g.coordinates] : g.coordinates)) };
}

// ── Point in outline ─────────────────────────────────────────────

export function contains(outline: Outline, lat: number, lon: number): boolean {
  return inArea({ lat, lon }, outline);
}
