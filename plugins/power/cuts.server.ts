import { fetchJson, z } from "../../server/kit";
import type { PowerCut, PowerCuts } from "./types";

/**
 * Today's power cuts on the Liander grid in the Amsterdam region, from the City of Amsterdam's open data
 * (Creative Commons, attribution). Liander reports each cut as an affected area with a cause, a crew status and a
 * bucketed customer count; no household is named. The feed covers the Amsterdam region only.
 */

const URL_CUTS = "https://api.data.amsterdam.nl/v1/stroomstoringen/stroomstoringen/?_format=geojson&_pageSize=200&_sort=-storingDatumGemeld";

const Ring = z.array(z.tuple([z.number(), z.number()]));
const Geometry = z.union([
  z.object({ type: z.literal("Polygon"), coordinates: z.array(Ring) }),
  z.object({ type: z.literal("MultiPolygon"), coordinates: z.array(z.array(Ring)) }),
]);

const Reply = z.object({
  features: z.array(
    z.object({
      geometry: Geometry.nullable(),
      properties: z.object({
        storingNummer: z.number(),
        storingType: z.string(),
        storingStatus: z.string(),
        storingOorzaak: z.string().nullable(),
        storingGetroffenKlanten: z.string().nullable(),
        storingGetroffenStraten: z.string().nullable(),
        storingDatumGemeld: z.string(),
        storingDatumSchatting: z.string().nullable(),
        storingDatumEind: z.string().nullable(),
        storingServiceUpdate: z.string().nullable(),
      }),
    }),
  ),
});

type Feature = z.infer<typeof Reply>["features"][number];

/** Liander writes dates as local Amsterdam time without an offset. */
export function amsterdamTime(naive: string): number | null {
  const guess = Date.parse(`${naive}Z`);
  if (!Number.isFinite(guess) || guess < Date.UTC(2000, 0, 1)) return null;
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Amsterdam", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(guess);
  const at = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const shown = Date.UTC(at("year"), at("month") - 1, at("day"), at("hour"), at("minute"), at("second"));
  return Math.floor((guess - (shown - guess)) / 1000);
}

const STATUS: Record<string, { status: PowerCut["status"]; text: string }> = {
  opgelost: { status: "fixed", text: "Fixed" },
  "monteur ter plaatse": { status: "on-site", text: "Crew on site" },
  "monteur onderweg": { status: "on-the-way", text: "Crew on the way" },
};

const CAUSE: Record<string, string> = {
  "Spontane storing": "Spontaneous fault",
  Graafwerkzaamheden: "Digging work",
  "Geplande werkzaamheden": "Planned work",
};

const sentence = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

const positions = (g: NonNullable<Feature["geometry"]>): [number, number][] => (g.type === "Polygon" ? g.coordinates.flat() : g.coordinates.flat(2));

function centre(g: NonNullable<Feature["geometry"]>): { lat: number; lon: number } {
  const all = positions(g);
  const lons = all.map((p) => p[0]);
  const lats = all.map((p) => p[1]);
  return { lon: (Math.min(...lons) + Math.max(...lons)) / 2, lat: (Math.min(...lats) + Math.max(...lats)) / 2 };
}

function toCut(f: Feature & { geometry: NonNullable<Feature["geometry"]> }): PowerCut {
  const p = f.properties;
  const known = STATUS[p.storingStatus];
  const c = centre(f.geometry);
  return {
    id: String(p.storingNummer),
    type: p.storingType === "P" ? "planned" : "fault",
    status: known?.status ?? "pending",
    statusText: known?.text ?? sentence(p.storingStatus),
    causeText: p.storingOorzaak ? (CAUSE[p.storingOorzaak] ?? sentence(p.storingOorzaak)) : "Cause not yet known",
    customers: (p.storingGetroffenKlanten ?? "").replace(/^<\s*/, "fewer than ") || "not reported",
    streets: [...new Set((p.storingGetroffenStraten ?? "").split(";").map((s) => s.trim()).filter(Boolean))].slice(0, 12),
    reported: amsterdamTime(p.storingDatumGemeld) ?? 0,
    estimatedFix: p.storingDatumSchatting ? amsterdamTime(p.storingDatumSchatting) : null,
    fixed: p.storingDatumEind ? amsterdamTime(p.storingDatumEind) : null,
    lat: c.lat,
    lon: c.lon,
  };
}

export async function fetchCuts(): Promise<PowerCuts> {
  const reply = await fetchJson("Amsterdam open data, power cuts", URL_CUTS, Reply);
  const withShape = reply.features.flatMap((f) => (f.geometry ? [{ ...f, geometry: f.geometry }] : []));
  const cuts = withShape.map(toCut);
  const updates = reply.features.flatMap((f) => (f.properties.storingServiceUpdate ? [Math.floor(Date.parse(f.properties.storingServiceUpdate.replace(" ", "T").replace(/\+00$/, "Z")) / 1000)] : []));
  return {
    at: Math.max(0, ...updates.filter(Number.isFinite)),
    cuts,
    areas: { type: "FeatureCollection", features: withShape.map((f, i) => ({ type: "Feature", properties: { id: cuts[i]?.id ?? "" }, geometry: f.geometry })) },
  };
}
