import { defineSource, describe, HttpError, json, lat, lon, parseQuery, webUrl, z } from "../../server/kit";
import { distanceM, geographicBoxes } from "../../shared/geo";
import { tomtomCached, tomtomJson } from "../traffic/tomtom.server";
import type { ChargingAvailability, ChargingReport, ChargingStation } from "./types";

const Count = z.number().int().nonnegative();
const Counts = z.object({ available: Count, occupied: Count, reserved: Count, unknown: Count, outOfService: Count });
export const Availability = z.object({ chargingAvailability: z.string(), connectors: z.array(z.object({ type: z.string(), total: Count,
  availability: z.object({ current: Counts, perPowerLevel: z.array(Counts.extend({ powerKW: z.number().nonnegative() })).default([]) }),
})) });
export const Search = z.object({ summary: z.object({ totalResults: Count }), results: z.array(z.object({
  id: z.string(), position: z.object({ lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180) }),
  poi: z.object({ name: z.string(), url: z.string().optional(), phone: z.string().optional(), brands: z.array(z.object({ name: z.string() })).optional() }),
  address: z.object({ freeformAddress: z.string().optional() }).optional(),
  chargingPark: z.object({ connectors: z.array(z.object({ connectorType: z.string(), ratedPowerKW: z.number().nonnegative().optional(), currentA: z.number().optional(), currentType: z.string().optional(), voltageV: z.number().optional() })) }).optional(),
  dataSources: z.object({ chargingAvailability: z.object({ id: z.string() }).optional() }).optional(),
})) });
const Box = z.object({ west: lon, south: lat, east: lon, north: lat }).refine((b) => b.south < b.north && b.west !== b.east, "Use a non-empty map area.");
type Box = z.infer<typeof Box>;

export function searchStations(result: z.infer<typeof Search>): ChargingStation[] {
  return result.results.map((s) => ({ id: s.id, name: s.poi.name, lat: s.position.lat, lon: s.position.lon,
    address: s.address?.freeformAddress ?? null, website: webUrl(s.poi.url && !URL.canParse(s.poi.url) ? `https://${s.poi.url}` : s.poi.url), phone: s.poi.phone ?? null,
    brands: s.poi.brands?.map((b) => b.name) ?? [], availabilityId: s.dataSources?.chargingAvailability?.id ?? null,
    connectors: s.chargingPark?.connectors ?? [], availability: null, availabilityError: null, checkedAt: null,
  }));
}

async function availability(id: string, key: string, signal: AbortSignal): Promise<{ data: ChargingAvailability; checkedAt: number }> {
  const { value, at } = await tomtomCached(`charging.availability:${id}`, "call", 3 * 60_000, async () => {
    const url = new URL("https://api.tomtom.com/search/2/chargingAvailability.json");
    url.search = new URLSearchParams({ key, chargingAvailability: id }).toString();
    const data = await tomtomJson("TomTom charger availability", url, Availability, key);
    if (data.chargingAvailability !== id) throw new HttpError(502, "availability_id", "TomTom returned availability for a different charging station.");
    return data;
  }, signal);
  return { data: value, checkedAt: at };
}

async function stations(box: Box, signal: AbortSignal): Promise<ChargingReport> {
  const key = process.env.VANTAGE_TOMTOM_KEY;
  if (!key) throw new HttpError(503, "needs_key", "Set VANTAGE_TOMTOM_KEY with Search and EV Charging Stations Availability access, then restart VANTAGE.");
  // Stations rarely move, so a view keeps its search for an hour; only availability refreshes every few minutes.
  const reports = await Promise.all(geographicBoxes(box).map(async (b) => (await tomtomCached(`charging.search:${b.west}:${b.south}:${b.east}:${b.north}`, "call", 60 * 60_000, () => {
    const url = new URL("https://api.tomtom.com/search/2/categorySearch/electric%20vehicle%20station.json");
    url.search = new URLSearchParams({ key, categorySet: "7309", limit: "20", lat: String((b.north + b.south) / 2), lon: String((b.west + b.east) / 2), topLeft: `${b.north},${b.west}`, btmRight: `${b.south},${b.east}` }).toString();
    return tomtomJson("TomTom charging stations", url, Search, key);
  }, signal)).value));
  const span = box.west > box.east ? box.east + 360 - box.west : box.east - box.west;
  const centerLon = box.west + span / 2;
  const center = { lat: (box.south + box.north) / 2, lon: centerLon > 180 ? centerLon - 360 : centerLon };
  const found = reports.flatMap(searchStations).filter((s) => s.lat >= box.south && s.lat <= box.north && (box.west <= box.east ? s.lon >= box.west && s.lon <= box.east : s.lon >= box.west || s.lon <= box.east));
  found.sort((a, b) => distanceM(center, a) - distanceM(center, b));
  const selected = found.slice(0, 20);
  // The TomTom queue paces the requests and asks for unchecked stations before it refreshes checked ones.
  await Promise.all(selected.map(async (s) => {
    if (!s.availabilityId) return;
    try { const reply = await availability(s.availabilityId, key, signal); s.availability = reply.data; s.checkedAt = reply.checkedAt; }
    catch (err: unknown) { s.availabilityError = describe(err); }
  }));
  return { stations: selected, capped: found.length > 20 || reports.some((r) => r.summary.totalResults > r.results.length), fetchedAt: Date.now() };
}

export default defineSource({ routes: { "GET /stations": async (req) => json(await stations(parseQuery(req, Box), req.signal)) } });
