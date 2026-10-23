/**
 * Readers for GBFS, the General Bikeshare Feed Specification that scooter and bike operators publish.
 * Versions 2.x and 3.x differ in names and in how text is localised; these functions accept both and return plain shapes.
 * Pure functions, so the differences between operators' feeds are covered by tests.
 */

export interface CatalogueEntry {
  country: string;
  name: string;
  location: string;
  id: string;
  discoveryUrl: string;
}

/** Split CSV text into rows of fields. Handles quoted fields with commas, doubled quotes and line breaks inside quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      if (row.some((f) => f !== "")) rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f !== "")) rows.push(row);
  return rows;
}

/** The MobilityData catalogue (systems.csv): one row per operator and city. */
export function parseCatalogue(csv: string): CatalogueEntry[] {
  const [header, ...rows] = parseCsv(csv);
  if (!header) return [];
  const col = (name: string): number => header.findIndex((h) => h.trim() === name);
  const [country, name, location, id, url] = ["Country Code", "Name", "Location", "System ID", "Auto-Discovery URL"].map(col);
  if ([country, name, location, id, url].some((c) => c === undefined || c < 0)) return [];
  return rows.flatMap((r) => {
    const discoveryUrl = (r[url as number] ?? "").trim();
    return /^https?:\/\//i.test(discoveryUrl) && r[id as number] ? [{ country: (r[country as number] ?? "").trim(), name: (r[name as number] ?? "").trim(), location: (r[location as number] ?? "").trim(), id: (r[id as number] ?? "").trim(), discoveryUrl }] : [];
  });
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Text that is a string in v2 and a list of `{text, language}` in v3. English wins, then the first entry. */
export function localized(v: unknown): string | null {
  if (typeof v === "string") return v === "" ? null : v;
  if (!Array.isArray(v)) return null;
  const items = v.filter(isRecord);
  const pick = items.find((i) => i.language === "en") ?? items[0];
  return pick ? str(pick.text) : null;
}

/** Feed name → URL from a gbfs.json discovery document (v2: per language; v3: one list). */
export function feedUrls(discovery: unknown): Record<string, string> {
  const data = isRecord(discovery) && isRecord(discovery.data) ? discovery.data : null;
  if (!data) return {};
  let feeds: unknown = data.feeds;
  if (!Array.isArray(feeds)) {
    const lang = isRecord(data.en) ? data.en : Object.values(data).find(isRecord);
    feeds = isRecord(lang) ? lang.feeds : undefined;
  }
  const out: Record<string, string> = {};
  if (Array.isArray(feeds)) for (const f of feeds) if (isRecord(f) && str(f.name) && str(f.url)) out[f.name as string] = f.url as string;
  return out;
}

/**
 * Operator and system names from a `system_information` feed. Its fields sit straight under `data`, in both
 * versions; only their text differs (v2 a string, v3 a list per language). Null when the feed omits them.
 */
export function systemInformation(feed: unknown): { operator: string | null; systemName: string | null } {
  const data = isRecord(feed) && isRecord(feed.data) ? feed.data : null;
  if (!data) return { operator: null, systemName: null };
  return { operator: localized(data.operator), systemName: localized(data.name) };
}

export interface RawVehicle {
  id: string;
  lat: number;
  lon: number;
  typeId: string | null;
  planId: string | null;
  /** Range in metres, when the operator reports it. */
  rangeM: number | null;
  /** Battery or fuel as a share from 0 to 1. */
  charge: number | null;
  /** The operator's own page or app link for renting this vehicle, when the feed carries one. */
  rentalUrl: string | null;
}

/**
 * Where the operator sends someone who wants to rent this vehicle: `rental_uris.web`, or an app link when it is
 * an https one that opens the app and falls back to the operator's page. Custom schemes (`tier://`) are left out:
 * they only work on a phone with that app installed, and the browser has nowhere to send them.
 */
function rentalUrl(v: Record<string, unknown>): string | null {
  const uris = isRecord(v.rental_uris) ? v.rental_uris : null;
  if (!uris) return null;
  for (const key of ["web", "android", "ios"]) {
    const url = str(uris[key]);
    if (url && /^https?:\/\//i.test(url)) return url;
  }
  return null;
}

/** Free vehicles from `free_bike_status` (v2: data.bikes) or `vehicle_status` (v3: data.vehicles). Reserved and disabled ones are left out. */
export function vehicleList(feed: unknown): RawVehicle[] {
  const data = isRecord(feed) && isRecord(feed.data) ? feed.data : null;
  const list = data ? (Array.isArray(data.vehicles) ? data.vehicles : Array.isArray(data.bikes) ? data.bikes : []) : [];
  const out: RawVehicle[] = [];
  for (const v of list) {
    if (!isRecord(v) || v.is_reserved === true || v.is_disabled === true) continue;
    const id = str(v.vehicle_id) ?? str(v.bike_id) ?? (num(v.bike_id) !== null ? String(v.bike_id) : null);
    const lat = num(v.lat);
    const lon = num(v.lon);
    if (!id || lat === null || lon === null || Math.abs(lat) > 90 || Math.abs(lon) > 180 || (lat === 0 && lon === 0)) continue;
    const fuel = num(v.current_fuel_percent);
    out.push({
      id,
      lat,
      lon,
      typeId: str(v.vehicle_type_id),
      planId: str(v.pricing_plan_id) ?? str(v.default_pricing_plan_id),
      rangeM: num(v.current_range_meters),
      charge: fuel === null ? null : Math.min(1, Math.max(0, fuel)),
      rentalUrl: rentalUrl(v),
    });
  }
  return out;
}

export type FormFactor = "bicycle" | "cargo_bicycle" | "car" | "moped" | "scooter_standing" | "scooter_seated" | "scooter" | "other";

export interface VehicleType {
  form: FormFactor;
  propulsion: string | null;
  maxRangeM: number | null;
  name: string | null;
}

const FORMS = new Set<string>(["bicycle", "cargo_bicycle", "car", "moped", "scooter_standing", "scooter_seated", "scooter", "other"]);

export function vehicleTypes(feed: unknown): Map<string, VehicleType> {
  const data = isRecord(feed) && isRecord(feed.data) ? feed.data : null;
  const out = new Map<string, VehicleType>();
  if (!data || !Array.isArray(data.vehicle_types)) return out;
  for (const t of data.vehicle_types) {
    const id = isRecord(t) ? str(t.vehicle_type_id) : null;
    if (!isRecord(t) || !id) continue;
    out.set(id, { form: FORMS.has(String(t.form_factor)) ? (t.form_factor as FormFactor) : "other", propulsion: str(t.propulsion_type), maxRangeM: num(t.max_range_meters), name: localized(t.name) });
  }
  return out;
}

export const FORM_NAME: Record<FormFactor, string> = {
  bicycle: "Bicycle",
  cargo_bicycle: "Cargo bicycle",
  car: "Car",
  moped: "Moped",
  scooter_standing: "Kick scooter",
  scooter_seated: "Seated scooter",
  scooter: "Scooter",
  other: "Vehicle",
};

/** The box around a set of vehicles, for deciding whether a system serves the area you are in. */
export function boxOf(vehicles: { lat: number; lon: number }[]): { west: number; south: number; east: number; north: number } | null {
  if (vehicles.length === 0) return null;
  // Operators sometimes list a test vehicle at their depot far away; the middle 90% of positions describe the service area.
  const lats = vehicles.map((v) => v.lat).sort((a, b) => a - b);
  const lons = vehicles.map((v) => v.lon).sort((a, b) => a - b);
  const cut = Math.floor(vehicles.length * 0.05);
  return { south: lats[cut] as number, north: lats[lats.length - 1 - cut] as number, west: lons[cut] as number, east: lons[lons.length - 1 - cut] as number };
}

const money = (amount: number, currency: string): string => {
  try {
    return new Intl.NumberFormat("en-GB", { style: "currency", currency, minimumFractionDigits: amount % 1 === 0 ? 0 : 2 }).format(amount);
  } catch {
    return `${amount} ${currency}`;
  }
};

/** One line per pricing plan, such as "Basic bike: unlock free, €0.28 per minute". */
export function pricingLines(feed: unknown): string[] {
  const data = isRecord(feed) && isRecord(feed.data) ? feed.data : null;
  if (!data || !Array.isArray(data.plans)) return [];
  const lines: string[] = [];
  for (const p of data.plans) {
    if (!isRecord(p)) continue;
    const name = localized(p.name) ?? "Plan";
    const currency = str(p.currency) ?? "";
    const price = num(p.price);
    const parts: string[] = [];
    if (price !== null && currency) parts.push(price === 0 ? "no unlock fee" : `${money(price, currency)} to unlock`);
    const perMin = Array.isArray(p.per_min_pricing) ? p.per_min_pricing.filter(isRecord)[0] : undefined;
    const rate = perMin ? num(perMin.rate) : null;
    if (rate !== null && currency) parts.push(`${money(rate, currency)} per ${num(perMin?.interval) && num(perMin?.interval) !== 1 ? `${perMin?.interval} minutes` : "minute"}`);
    const perKm = Array.isArray(p.per_km_pricing) ? p.per_km_pricing.filter(isRecord)[0] : undefined;
    const kmRate = perKm ? num(perKm.rate) : null;
    if (kmRate !== null && currency) parts.push(`${money(kmRate, currency)} per km`);
    lines.push(parts.length > 0 ? `${name}: ${parts.join(", ")}` : (localized(p.description) ? `${name}: ${localized(p.description)}` : name));
  }
  return lines;
}
