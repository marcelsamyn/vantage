import { HttpError, diskMemo, fetchPublic, fetchUpstream, log, memo, reverseGeocode, webUrl, z } from "../../server/kit";
import { distanceM } from "../../shared/geo";
import { FORM_NAME, boxOf, feedUrls, parseCatalogue, pricingLines, systemInformation, vehicleList, vehicleTypes, type CatalogueEntry, type VehicleType } from "./gbfs";
import type { FreeVehicle, FreeVehicles } from "./types";

/**
 * Scooters and free-floating bikes from GBFS feeds. The MobilityData catalogue lists the operators' feeds. Those addresses come
 * from a third party, so every fetch goes through `fetchPublic`, and the browser only ever names a system by its id.
 */

const CATALOGUE_URL = "https://raw.githubusercontent.com/MobilityData/gbfs/master/systems.csv";
const MAX_FEED_BYTES = 12_000_000;
const FEED_TIMEOUT_MS = 9_000;
/** A system serves the area around its vehicles; this much extra tolerates a user at the edge of town. */
const SERVICE_MARGIN_DEG = 0.2;
const MAX_SYSTEMS_PER_COUNTRY = 140;
const MAX_VEHICLES = 2500;

interface SystemInfo {
  entry: CatalogueEntry;
  urls: { vehicles: string; types: string | null; pricing: string | null; system_information: string | null };
  box: { west: number; south: number; east: number; north: number };
  /** Names the feed gives for itself and its operator; null when it says nothing. */
  names: { operator: string | null; systemName: string | null };
}

/** The catalogue and a system's service area are kept on disk, so what is read back is checked against the fields the code expects. */
const StoredEntry = z.object({ country: z.string(), name: z.string(), location: z.string(), id: z.string(), discoveryUrl: z.string() });
const StoredSystem = z.object({
  entry: StoredEntry,
  urls: z.object({ vehicles: z.string(), types: z.string().nullable(), pricing: z.string().nullable(), system_information: z.string().nullable() }),
  box: z.object({ west: z.number(), south: z.number(), east: z.number(), north: z.number() }),
  names: z.object({ operator: z.string().nullable(), systemName: z.string().nullable() }),
});

/** Systems whose feeds were read, by id; /pricing looks the feed address up here rather than accepting one from the browser. */
const known = new Map<string, SystemInfo>();
/** Systems that had no usable feed, and when to look again. */
const unusableUntil = new Map<string, number>();
const UNUSABLE_FOR_MS = 3_600_000;

async function getJson(source: string, url: string): Promise<unknown> {
  const res = await fetchPublic(source, url, { timeoutMs: FEED_TIMEOUT_MS, headers: { accept: "application/json" } });
  const text = await res.text();
  if (text.length > MAX_FEED_BYTES) throw new HttpError(502, "upstream_too_large", `${source} sent a feed larger than ${MAX_FEED_BYTES / 1e6} MB`);
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new HttpError(502, "upstream_shape", `${source} sent a response that is not JSON`);
  }
}

const catalogue = (): Promise<CatalogueEntry[]> =>
  diskMemo("gbfs-systems", 24 * 3_600_000, async () => parseCatalogue(await (await fetchUpstream("MobilityData catalogue", CATALOGUE_URL, { timeoutMs: 20_000, headers: { accept: "text/csv, text/plain" } })).text()), z.array(StoredEntry));

/** Read one system's discovery file and vehicle feed to learn where it operates. Throws when it has no free-floating vehicles right now. */
async function readSystem(entry: CatalogueEntry): Promise<SystemInfo> {
  const urls = feedUrls(await getJson(entry.name, entry.discoveryUrl));
  const vehicles = urls.vehicle_status ?? urls.free_bike_status;
  if (!vehicles) throw new HttpError(404, "no_vehicle_feed", `${entry.name} publishes stations only`);
  const box = boxOf(vehicleList(await getJson(entry.name, vehicles)));
  if (!box) throw new HttpError(404, "no_vehicles", `${entry.name} lists no free vehicles right now`);
  const names = urls.system_information ? systemInformation(await getJson(entry.name, urls.system_information)) : { operator: null, systemName: null };
  return { entry, urls: { vehicles, types: urls.vehicle_types ?? null, pricing: urls.system_pricing_plans ?? null, system_information: urls.system_information ?? null }, box, names };
}

/** The service area of a system does not move, so it is remembered for a week. */
function systemInfo(entry: CatalogueEntry): Promise<SystemInfo | null> {
  if ((unusableUntil.get(entry.id) ?? 0) > Date.now()) return Promise.resolve(null);
  return diskMemo(`gbfs-system-${entry.id}`, 7 * 86_400_000, () => readSystem(entry), StoredSystem)
    .then((info) => {
      known.set(entry.id, info);
      return info;
    })
    .catch((err: unknown) => {
      unusableUntil.set(entry.id, Date.now() + UNUSABLE_FOR_MS);
      log.info("gbfs system skipped", { system: entry.id, error: err instanceof Error ? err.message : String(err) });
      return null;
    });
}

/** Run `task` over `items` with at most `limit` in flight. */
async function pool<T, R>(items: T[], limit: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const i = next++;
      results[i] = await task(items[i] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/** Systems in the user's country whose service area includes the point. The first request in a country reads every system once. */
async function systemsAround(lat: number, lon: number): Promise<SystemInfo[]> {
  const country = (await reverseGeocode(lat, lon))?.countryCode;
  if (!country) throw new HttpError(404, "no_country", "Could not tell which country this point is in, so there is no list of operators to check.");
  return memo(`gbfs:index:${country}:${lat.toFixed(1)},${lon.toFixed(1)}`, 30 * 60_000, async () => {
    const entries = (await catalogue()).filter((e) => e.country === country).slice(0, MAX_SYSTEMS_PER_COUNTRY);
    const infos = await pool(entries, 8, systemInfo);
    return infos.filter((i): i is SystemInfo => i !== null && lat >= i.box.south - SERVICE_MARGIN_DEG && lat <= i.box.north + SERVICE_MARGIN_DEG && lon >= i.box.west - SERVICE_MARGIN_DEG && lon <= i.box.east + SERVICE_MARGIN_DEG);
  });
}

const typesOf = (info: SystemInfo): Promise<Map<string, VehicleType>> =>
  info.urls.types ? memo(`gbfs:types:${info.entry.id}`, 6 * 3_600_000, async () => vehicleTypes(await getJson(info.entry.name, info.urls.types as string)), 24 * 3_600_000).catch(() => new Map()) : Promise.resolve(new Map());

/** Free vehicles within `radiusKm` of a point, from every operator that serves it. */
export async function freeVehiclesNear(lat: number, lon: number, radiusKm: number): Promise<FreeVehicles> {
  const systems = await systemsAround(lat, lon);
  const at = { lat, lon };
  const perSystem = await Promise.all(
    systems.map(async (info) => {
      try {
        const [raw, types] = await Promise.all([memo(`gbfs:vehicles:${info.entry.id}`, 60_000, async () => vehicleList(await getJson(info.entry.name, info.urls.vehicles)), 10 * 60_000), typesOf(info)]);
        const vehicles = raw
          .map((v) => ({ v, d: distanceM(at, v) }))
          .filter((x) => x.d <= radiusKm * 1000)
          .map(({ v }): FreeVehicle => {
            const t = v.typeId ? types.get(v.typeId) : undefined;
            return {
              id: `${info.entry.id}~${v.id}`,
              systemId: info.entry.id,
              systemName: info.names.systemName ?? info.entry.name,
              operator: info.names.operator,
              lat: v.lat,
              lon: v.lon,
              form: t?.form ?? "other",
              formName: t ? FORM_NAME[t.form] : "Bike or scooter",
              propulsion: t?.propulsion ?? null,
              typeName: t?.name ?? null,
              planId: v.planId,
              rangeM: v.rangeM,
              maxRangeKm: t?.maxRangeM ? Math.round(t.maxRangeM / 100) / 10 : null,
              charge: v.charge,
              // The feed is a third party's, and the browser may open this link, so only plain http(s) gets through.
              rentalUrl: webUrl(v.rentalUrl),
            };
          });
        return { system: { id: info.entry.id, name: info.entry.name, count: vehicles.length, ok: true as const }, vehicles };
      } catch (err) {
        return { system: { id: info.entry.id, name: info.entry.name, count: 0, ok: false as const, error: err instanceof Error ? err.message : String(err) }, vehicles: [] as FreeVehicle[] };
      }
    }),
  );
  const vehicles = perSystem.flatMap((p) => p.vehicles).sort((a, b) => distanceM(at, a) - distanceM(at, b)).slice(0, MAX_VEHICLES);
  return { fetchedAt: Date.now(), systems: perSystem.map((p) => p.system), vehicles };
}

/** Pricing plans a system publishes, as one line each. Empty when it publishes none. */
export async function pricingOf(systemId: string): Promise<string[]> {
  const info = known.get(systemId);
  if (!info) throw new HttpError(404, "unknown_system", "That system is not one VANTAGE has read. Open a scooter on the map first.");
  const url = info.urls.pricing;
  if (!url) return [];
  return memo(`gbfs:pricing:${systemId}`, 6 * 3_600_000, async () => pricingLines(await getJson(info.entry.name, url)), 24 * 3_600_000);
}
