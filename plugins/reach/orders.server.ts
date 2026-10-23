import { HttpError, describe, fetchJson, fetchUpstream, memo, parseUpstream, webUrl, z } from "../../server/kit";
import { distanceM, type LatLon } from "../../shared/geo";
import { lambert72ToWgs84 } from "./lambert72";
import type { OrderList, OrderSource, OrderStatus, ReportLink, WorkOrder } from "./types";

const HEADERS = { "user-agent": "VANTAGE/1.0 (personal dashboard; local)" };
const MAX_ORDERS = 80;

// ── Text safety ───────────────────────────────────────────────────

const ROLE_NAME = /\b([Rr]esidents?|[Cc]aller|[Cc]itizen|[Cc]ustomer|[Rr]eporter|[Cc]onstituent|[Hh]omeowner|[Mm]r|[Mm]rs|[Mm]s|[Mm]iss)\.?\s+(?:[A-Z][\w'’-]+\s?){1,3}/g;

/**
 * Reports are written by the public and sometimes name the person who phoned them in. This keeps the problem and
 * drops what identifies a person or points elsewhere: links, contact details, "reported by" lines, and a name after a role or title.
 * It is a best effort, so the original text is never stored or sent on.
 */
function scrub(text: string | null | undefined, max = 300): string | null {
  const t = (text ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, "")
    .replace(/(?:\+?\d[\d\s().-]{7,}\d)/g, "")
    .replace(/\b(?:reported|submitted|called in|filed) by[^.\n]*/gi, "")
    .replace(ROLE_NAME, (_m, role: string) => `${role} `)
    .replace(/\s+/g, " ")
    .trim();
  if (!t) return null;
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), max - 40))}…`;
}

const https = (u: string | null | undefined): string | null => (u && u.startsWith("https://") ? u : null);

function bbox(c: LatLon, radiusM: number): { south: number; north: number; west: number; east: number } {
  const dLat = radiusM / 111_320;
  const dLon = radiusM / (111_320 * Math.max(0.2, Math.cos((c.lat * Math.PI) / 180)));
  return { south: c.lat - dLat, north: c.lat + dLat, west: c.lon - dLon, east: c.lon + dLon };
}

const inBox = (c: LatLon, b: [south: number, north: number, west: number, east: number]): boolean => c.lat >= b[0] && c.lat <= b[1] && c.lon >= b[2] && c.lon <= b[3];

// ── SeeClickFix ───────────────────────────────────────────────────

const SCF = "SeeClickFix";
const scfPage = z.object({
  issues: z.array(
    z.object({
      id: z.number(),
      status: z.string(),
      description: z.string().nullable(),
      lat: z.number(),
      lng: z.number(),
      created_at: z.string(),
      html_url: z.string(),
      request_type: z.object({ title: z.string().optional(), organization: z.string().nullable().optional() }).nullable().optional(),
      media: z.object({ image_full: z.string().nullable().optional() }).nullable().optional(),
    }),
  ),
  metadata: z.object({ pagination: z.object({ next_page: z.number().nullable() }) }),
});

async function seeClickFix(c: LatLon, radiusM: number): Promise<WorkOrder[]> {
  const b = bbox(c, radiusM);
  const out: WorkOrder[] = [];
  for (let page = 1; page <= 2; page++) {
    const url = new URL("https://seeclickfix.com/api/v2/issues");
    url.search = new URLSearchParams({
      min_lat: b.south.toFixed(5),
      max_lat: b.north.toFixed(5),
      min_lng: b.west.toFixed(5),
      max_lng: b.east.toFixed(5),
      status: "open,acknowledged",
      per_page: "20",
      page: String(page),
    }).toString();
    const data = await fetchJson(SCF, url, scfPage, { headers: HEADERS });
    for (const i of data.issues) {
      // Reports with no request type are not routed to any city: in practice they are spam and chatter.
      const category = i.request_type?.title;
      if (!category) continue;
      out.push({
        id: `scf:${i.id}`,
        operator: SCF,
        authority: i.request_type?.organization ?? null,
        category,
        status: i.status.toLowerCase() === "acknowledged" ? "acknowledged" : "open",
        createdAt: Date.parse(i.created_at),
        description: scrub(i.description),
        photo: https(i.media?.image_full),
        lat: i.lat,
        lon: i.lng,
        url: webUrl(i.html_url) ?? "https://seeclickfix.com/",
      });
    }
    if (data.metadata.pagination.next_page === null) break;
  }
  return out;
}

// ── FixMyStreet family (RSS) ──────────────────────────────────────

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
function decode(s: string): string {
  return s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
    if (e.startsWith("#")) {
      const code = e[1]?.toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

const tag = (xml: string, name: string): string | null => {
  const m = new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`).exec(xml);
  return m?.[1] ? decode(m[1]).replace(/^<!\[CDATA\[|\]\]>$/g, "") : null;
};

/** FixMyStreet sites publish "local problems" as RSS with a GeoRSS point; every site runs the same software. */
async function fixMyStreet(site: { name: string; host: string }, c: LatLon): Promise<WorkOrder[]> {
  const res = await fetchUpstream(site.name, `https://${site.host}/rss/l/${c.lat.toFixed(4)},${c.lon.toFixed(4)}`, { headers: { ...HEADERS, accept: "application/rss+xml, application/xml" } });
  const xml = await res.text();
  const out: WorkOrder[] = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const item = m[1] ?? "";
    const point = /<georss:point>\s*(-?[\d.]+)\s+(-?[\d.]+)\s*<\/georss:point>/.exec(item);
    const link = tag(item, "link") ?? "";
    const category = tag(item, "category");
    const created = Date.parse(tag(item, "pubDate") ?? "");
    const lat = Number(point?.[1]);
    const lon = Number(point?.[2]);
    const id = /\/report\/(\d+)/.exec(link)?.[1];
    if (!id || !category || !Number.isFinite(created) || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const body = tag(item, "description") ?? "";
    out.push({
      id: `${site.host}:${id}`,
      operator: site.name,
      authority: null,
      category,
      status: "open",
      createdAt: created,
      // The text runs up to the first line break; the rest is a photo, a street name and a link back.
      description: scrub(body.split(/\n?<br\s*\/?>/i)[0]),
      photo: https(/<img[^>]+src="([^"]+)"/i.exec(body)?.[1]),
      lat,
      lon,
      url: webUrl(link) ?? `https://${site.host}/`,
    });
  }
  return out;
}

// ── Open311 GeoReport v2 (Boston) ─────────────────────────────────

const OPEN311_BOSTON = "Boston 311";
const bostonRow = z.object({
  service_request_id: z.string(),
  status: z.string(),
  service_name: z.string(),
  description: z.string().nullable().optional(),
  requested_datetime: z.string(),
  lat: z.number(),
  long: z.number(),
  media_url: z.string().nullable().optional(),
});

async function boston(): Promise<WorkOrder[]> {
  // GeoReport v2 has no map search, so take the newest open requests for the whole city and filter by distance later.
  const res = await fetchUpstream(OPEN311_BOSTON, "https://311.boston.gov/open311/v2/requests.json?status=open&page_size=200", { headers: HEADERS });
  const rows = parseUpstream(OPEN311_BOSTON, z.array(bostonRow), await res.json());
  return rows.map((r) => ({
    id: `boston:${r.service_request_id}`,
    operator: OPEN311_BOSTON,
    authority: "City of Boston",
    category: r.service_name,
    status: "open" satisfies OrderStatus,
    createdAt: Date.parse(r.requested_datetime),
    description: scrub(r.description),
    photo: https(r.media_url || null),
    lat: r.lat,
    lon: r.long,
    url: "https://311.boston.gov/",
  }));
}

// ── Cologne ("Sags uns", Open311 GeoReport v2) ────────────────────

const COLOGNE = "Köln Sags uns";
const cologneRow = z.object({
  service_request_id: z.string(),
  description: z.string().nullable().optional(),
  lat: z.number(),
  long: z.number(),
  service_name: z.string(),
  requested_datetime: z.string(),
  media_url: z.string().nullable().optional(),
});

async function cologne(): Promise<WorkOrder[]> {
  const res = await fetchUpstream(COLOGNE, "https://sags-uns.stadt-koeln.de/georeport/v2/requests.json?status=open", { headers: HEADERS });
  const rows = parseUpstream(COLOGNE, z.array(cologneRow), await res.json());
  return rows.map((r) => ({
    id: `koeln:${r.service_request_id}`,
    operator: COLOGNE,
    authority: "Stadt Köln",
    category: r.service_name,
    status: "open" satisfies OrderStatus,
    createdAt: Date.parse(r.requested_datetime),
    description: scrub(r.description),
    photo: https(r.media_url || null),
    lat: r.lat,
    lon: r.long,
    url: "https://sags-uns.stadt-koeln.de/",
  }));
}

// ── Brussels (Fix My Street Brussels, public REST API) ────────────

const BRUSSELS = "Fix My Street Brussels";
const brusselsPage = z.object({
  _embedded: z.object({
    response: z.array(
      z.object({
        id: z.number(),
        creationDate: z.string(),
        status: z.string(),
        location: z.object({ coordinates: z.object({ x: z.number(), y: z.number() }) }),
        responsibleOrganisation: z.object({ nameEn: z.string().nullable().optional() }).nullable().optional(),
        category: z.object({ nameEn: z.string().nullable().optional(), nameFr: z.string() }),
      }),
    ),
  }),
});

async function brussels(): Promise<WorkOrder[]> {
  // The list has no map search and comes newest-updated first, so the latest 500 incidents stand for the region.
  // Incidents carry no free text, and their positions are in Belgian Lambert 72.
  const data = await fetchJson(BRUSSELS, "https://fixmystreet.brussels/api/incidents?size=500", brusselsPage, { headers: HEADERS, timeoutMs: 25_000 });
  const out: WorkOrder[] = [];
  for (const i of data._embedded.response) {
    if (i.status !== "CREATED" && i.status !== "PROCESSING") continue;
    const at = lambert72ToWgs84(i.location.coordinates.x, i.location.coordinates.y);
    out.push({
      id: `brussels:${i.id}`,
      operator: BRUSSELS,
      authority: i.responsibleOrganisation?.nameEn ?? null,
      category: i.category.nameEn ?? i.category.nameFr,
      status: i.status === "CREATED" ? "open" : "acknowledged",
      // Brussels sends local time without an offset; read as UTC it is at most two hours off.
      createdAt: Date.parse(`${i.creationDate}Z`),
      description: null,
      photo: null,
      lat: at.lat,
      lon: at.lon,
      url: "https://fixmystreet.brussels/",
    });
  }
  return out;
}

// ── Services and where they apply ─────────────────────────────────

interface Service {
  name: string;
  /** [south, north, west, east]; omitted for services that answer anywhere. */
  area?: [number, number, number, number];
  load: (c: LatLon, radiusM: number) => Promise<WorkOrder[]>;
  /** The service's own page for starting a report at a point. */
  report?: (at: LatLon) => string;
}

const fms = (name: string, host: string, area: [number, number, number, number]): Service => ({
  name,
  area,
  load: (c) => fixMyStreet({ name, host }, c),
  report: (at) => `https://${host}/report/new?latitude=${at.lat.toFixed(6)}&longitude=${at.lon.toFixed(6)}`,
});

const SERVICES: Service[] = [
  { name: SCF, load: seeClickFix },
  fms("FixMyStreet", "www.fixmystreet.com", [49.8, 60.95, -8.7, 1.85]),
  fms("FixaMinGata", "www.fixamingata.se", [55.3, 69.1, 10.9, 24.2]),
  fms("Züri wie neu", "www.zueriwieneu.ch", [47.2, 47.7, 8.35, 8.8]),
  { name: OPEN311_BOSTON, area: [42.22, 42.4, -71.2, -70.99], load: boston, report: () => "https://311.boston.gov/" },
  { name: BRUSSELS, area: [50.76, 50.92, 4.24, 4.5], load: brussels, report: () => "https://fixmystreet.brussels/" },
  { name: COLOGNE, area: [50.82, 51.1, 6.75, 7.2], load: cologne, report: () => "https://sags-uns.stadt-koeln.de/" },
];

const serving = (c: LatLon): Service[] => SERVICES.filter((s) => !s.area || inBox(c, s.area));

/** The centre of the 0.01 degree cell (about 1 km) that holds the point. Callers in one cell share one cached answer. */
export function snapPoint(c: LatLon): LatLon {
  return { lat: Math.round(c.lat * 100) / 100, lon: Math.round(c.lon * 100) / 100 };
}

/**
 * Open work orders within `radiusM` of a point, from every reporting service that covers it, nearest first.
 * The answer is cached per cell, so it is computed from the cell's centre and every caller in the cell gets the same list.
 */
export function ordersNear(point: LatLon, radiusM: number): Promise<OrderList> {
  const c = snapPoint(point);
  const key = `reach-orders:${c.lat.toFixed(2)},${c.lon.toFixed(2)},${Math.round(radiusM / 500)}`;
  return memo(key, 3 * 60_000, async () => {
    const services = serving(c);
    const results = await Promise.allSettled(services.map((s) => s.load(c, radiusM)));
    const sources: OrderSource[] = [];
    const orders: (WorkOrder & { d: number })[] = [];
    results.forEach((r, i) => {
      const name = services[i]?.name ?? "";
      if (r.status === "rejected") {
        sources.push({ operator: name, error: r.reason instanceof HttpError ? r.reason.message : describe(r.reason) });
        return;
      }
      sources.push({ operator: name, error: null });
      for (const o of r.value) {
        const d = distanceM(c, o);
        if (d <= radiusM) orders.push({ ...o, d });
      }
    });
    orders.sort((a, b) => a.d - b.d);
    return { center: c, radiusM, fetchedAt: Date.now(), orders: orders.slice(0, MAX_ORDERS).map(({ d: _d, ...o }) => o), sources } satisfies OrderList;
  });
}

// ── "Report a problem here" ───────────────────────────────────────

const scfPlaces = z.object({
  places: z.array(z.object({ place_type: z.string(), name: z.string(), html_report_url: z.string(), center: z.object({ coordinates: z.tuple([z.number(), z.number()]) }) })),
});

/**
 * The operator's own reporting page for a point, so the user submits there and VANTAGE never does.
 * A FixMyStreet-family site or Boston answers for its own area. Elsewhere SeeClickFix is offered only when
 * its reports show it is in use within 10 km, because it lists a community page for many towns that nobody serves.
 */
export async function reportLink(point: LatLon): Promise<ReportLink | null> {
  // These links carry the exact point and cost nothing to build, so they are never cached.
  const own = serving(point).find((s) => s.report);
  if (own?.report) return { operator: own.name, url: own.report(point) };
  const at = snapPoint(point);
  return memo(`reach-report:${at.lat.toFixed(2)},${at.lon.toFixed(2)}`, 3_600_000, async () => {
    const near = await ordersNear(at, 10_000);
    if (!near.orders.some((o) => o.operator === SCF)) return null;
    const url = new URL("https://seeclickfix.com/api/v2/places");
    url.search = new URLSearchParams({ lat: at.lat.toFixed(5), lng: at.lon.toFixed(5) }).toString();
    const { places } = await fetchJson(SCF, url, scfPlaces, { headers: HEADERS });
    const city = places
      .filter((p) => p.place_type === "City")
      .map((p) => ({ p, d: distanceM(at, { lat: p.center.coordinates[1], lon: p.center.coordinates[0] }) }))
      .sort((a, b) => a.d - b.d)[0];
    const report = city && city.d < 30_000 ? webUrl(city.p.html_report_url) : null;
    return city && report ? { operator: `${SCF} · ${city.p.name}`, url: report } : null;
  });
}
