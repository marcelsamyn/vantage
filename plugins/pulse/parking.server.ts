import { HttpError, diskMemo, fetchJson, fetchUpstream, memo, webUrl, z } from "../../server/kit";
import { zoned } from "./time.server";
import type { CarPark } from "./types";

/**
 * Live free spaces in car parks, from the cities that publish them as open data:
 * Ghent (Modellicentie Gratis Hergebruik), Bologna (CC BY 4.0) and Zurich (CC0).
 * Each feed updates about every minute, so values are held for 60 seconds.
 */

const TTL_MS = 60_000;

const Coord = z.object({ lat: z.number(), lon: z.number() });

// ── Ghent ─────────────────────────────────────────────────────────

const GhentPage = z.object({
  results: z.array(
    z.object({
      name: z.string(),
      lastupdate: z.string().nullish(),
      totalcapacity: z.number().nullish(),
      availablecapacity: z.number().nullish(),
      isopennow: z.number().nullish(),
      temporaryclosed: z.number().nullish(),
      description: z.string().nullish(),
      urllinkaddress: z.string().nullish(),
      openingtimesdescription: z.string().nullish(),
      location: Coord.nullish(),
    }),
  ),
});

async function ghent(): Promise<CarPark[]> {
  const page = await fetchJson("Ghent car parks", "https://data.stad.gent/api/explore/v2.1/catalog/datasets/bezetting-parkeergarages-real-time/records?limit=50", GhentPage);
  const parks: CarPark[] = [];
  for (const r of page.results) {
    if (!r.location) continue;
    const capacity = r.totalcapacity ?? null;
    // Dampoort reports more free spaces than it has; the figure cannot be trusted past the capacity.
    const free = r.availablecapacity === null || r.availablecapacity === undefined ? null : capacity === null ? r.availablecapacity : Math.min(r.availablecapacity, capacity);
    parks.push({
      id: `gent:${r.name}`,
      name: r.name,
      city: "Ghent",
      lat: r.location.lat,
      lon: r.location.lon,
      free,
      capacity,
      open: r.isopennow === 1 && r.temporaryclosed !== 1,
      at: r.lastupdate ? Date.parse(r.lastupdate) : null,
      detail: r.openingtimesdescription ?? null,
      url: webUrl(r.urllinkaddress),
    });
  }
  return parks;
}

// ── Bologna ───────────────────────────────────────────────────────

const BolognaPage = z.object({
  results: z.array(
    z.object({
      parcheggio: z.string(),
      data: z.string().nullish(),
      posti_liberi: z.number().nullish(),
      posti_totali: z.number().nullish(),
      guid: z.string(),
      coordinate: Coord.nullish(),
    }),
  ),
});

async function bologna(): Promise<CarPark[]> {
  const page = await fetchJson("Bologna car parks", "https://opendata.comune.bologna.it/api/explore/v2.1/catalog/datasets/disponibilita-parcheggi-vigente/records?limit=50", BolognaPage);
  const parks: CarPark[] = [];
  for (const r of page.results) {
    if (!r.coordinate) continue;
    parks.push({
      id: `bologna:${r.guid}`,
      name: r.parcheggio,
      city: "Bologna",
      lat: r.coordinate.lat,
      lon: r.coordinate.lon,
      free: r.posti_liberi ?? null,
      capacity: r.posti_totali ?? null,
      open: true,
      // The feed marks local Bologna time as UTC; read the clock as Rome's.
      at: r.data ? zoned(r.data, "Europe/Rome") : null,
      detail: null,
      url: null,
    });
  }
  return parks;
}

// ── Zurich ────────────────────────────────────────────────────────

const ZurichPlaces = z.object({
  features: z.array(
    z.object({
      geometry: z.object({ coordinates: z.tuple([z.number(), z.number()]).rest(z.number()) }),
      properties: z.object({ name: z.string(), objekt: z.string().nullish(), adresse: z.string().nullish(), anzahl_oeffentliche_pp: z.number().nullish(), link_pls: z.string().nullish() }),
    }),
  ),
});

interface ZurichPlace {
  name: string;
  address: string | null;
  lat: number;
  lon: number;
  capacity: number | null;
  link: string | null;
}

const StoredZurichPlaces = z.array(z.object({ name: z.string(), address: z.string().nullable(), lat: z.number(), lon: z.number(), capacity: z.number().nullable(), link: z.string().nullable() }));

/** Where Zurich's car parks are: the city's open geodata (CC0), refreshed rarely. */
function zurichPlaces(): Promise<ZurichPlace[]> {
  return diskMemo("pulse-zurich-parkhaeuser", 7 * 24 * 3_600_000, async () => {
    const url = new URL("https://www.ogd.stadt-zuerich.ch/wfs/geoportal/Oeffentlich_zugaengliche_Parkhaeuser");
    for (const [k, v] of Object.entries({ SERVICE: "WFS", REQUEST: "GetFeature", VERSION: "1.1.0", TYPENAME: "poi_parkhaus_view", outputFormat: "GeoJSON", srsName: "EPSG:4326" })) url.searchParams.set(k, v);
    const data = await fetchJson("Zurich car park locations", url, ZurichPlaces, { timeoutMs: 25_000 });
    return data.features.map((f) => ({
      name: f.properties.name,
      address: f.properties.adresse ?? null,
      lon: f.geometry.coordinates[0],
      lat: f.geometry.coordinates[1],
      capacity: f.properties.anzahl_oeffentliche_pp ?? null,
      link: webUrl(f.properties.link_pls),
    }));
  }, StoredZurichPlaces);
}

interface ZurichItem {
  title: string;
  link: string;
  description: string;
  at: number | null;
}

function zurichItems(xml: string): ZurichItem[] {
  const out: ZurichItem[] = [];
  for (const block of xml.split("<item>").slice(1)) {
    const tag = (t: string): string => block.match(new RegExp(`<${t}>([^<]*)</${t}>`))?.[1]?.trim() ?? "";
    const at = Date.parse(tag("dc:date"));
    out.push({ title: tag("title"), link: tag("link"), description: tag("description"), at: Number.isFinite(at) ? at : null });
  }
  return out;
}

const norm = (s: string): string => s.toLowerCase().replace(/^parkhaus\s+/, "").replace(/\s*\/.*$/, "").replace(/[^a-z0-9äöüéèà]+/g, " ").trim();

async function zurich(): Promise<CarPark[]> {
  const [places, res] = await Promise.all([zurichPlaces(), fetchUpstream("Zurich car parks", "https://www.pls-zh.ch/plsFeed/rss", { headers: { accept: "application/rss+xml, application/xml, */*" } })]);
  const items = zurichItems(await res.text());
  const byLink = new Map(places.filter((p) => p.link).map((p) => [p.link, p]));
  const byName = new Map(places.map((p) => [norm(p.name), p]));
  const parks: CarPark[] = [];
  for (const item of items) {
    const place = byLink.get(item.link) ?? byName.get(norm(item.title));
    if (!place) continue;
    // "open /  155": the state, then the free spaces. Closed or full houses say so in words.
    const m = /^(\w+)\s*\/\s*(\d+)?/.exec(item.description);
    const open = m?.[1]?.toLowerCase() === "open";
    parks.push({
      id: `zurich:${item.link}`,
      name: place.name,
      city: "Zurich",
      lat: place.lat,
      lon: place.lon,
      free: m?.[2] === undefined ? null : Math.min(Number(m[2]), place.capacity ?? Number(m[2])),
      capacity: place.capacity,
      open,
      at: item.at,
      detail: place.address,
      url: webUrl(item.link),
    });
  }
  return parks;
}

// ── All cities ────────────────────────────────────────────────────

export interface ParkingResult {
  parks: CarPark[];
  /** Cities whose feed failed this time. */
  errors: string[];
}

export async function carParks(): Promise<ParkingResult> {
  return memo("pulse:parking", TTL_MS, async () => {
    const feeds = [
      { city: "Ghent", load: ghent },
      { city: "Bologna", load: bologna },
      { city: "Zurich", load: zurich },
    ];
    const settled = await Promise.allSettled(feeds.map((f) => f.load()));
    const parks: CarPark[] = [];
    const errors: string[] = [];
    settled.forEach((r, i) => {
      if (r.status === "fulfilled") parks.push(...r.value);
      else errors.push(`${feeds[i]?.city}: ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`);
    });
    if (parks.length === 0) throw new HttpError(502, "upstream_unreachable", `No car-park feed answered. ${errors.join("; ")}`);
    return { parks, errors };
  });
}
