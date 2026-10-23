import { diskMemo, fetchJson, memo, webUrl, z } from "../../../server/kit";
import { boxesMeet, inBox } from "../box";
import { addDays, dateIn, daysBetween, isDateOnly } from "../days";
import type { Box, ReportCategory, ReportStatus, StreetReport } from "../types";
import { HEADERS, type PostSource } from "./source.server";

/**
 * Fix My Street Brussels: reports of street problems in the Brussels region, published by Brussels Mobility as
 * open data (CC0, https://data-mobility.irisnet.be/en/info/a609a408-4ff1-47df-a0de-d4906bb89469/) through a WFS.
 *
 * The request asks for the report's free-text `comment` and house number and for the dates the layer records. The layer
 * names no reporter and publishes photo ids, not photo addresses, so reports show no author and no photo.
 *
 * Dates: the layer has a creation date and no time. Dates are Brussels calendar days.
 */

const SOURCE = "Fix My Street Brussels";
const WFS = "https://data.mobility.brussels/geoserver/bm_maintenance_and_planning/wfs";
const CODES = "https://data.mobility.brussels/data/attributevalues/?tid=fims_code_category";
const ZONE = "Europe/Brussels";
/** Reports of today and the 7 days before. */
export const WINDOW_DAYS = 7;
/** The Brussels-Capital Region with a margin. */
const REGION: Box = { west: 4.23, south: 50.75, east: 4.5, north: 50.92 };
const MAX_FEATURES = 6000;

const feature = z.object({
  geometry: z.object({ type: z.literal("Point"), coordinates: z.tuple([z.number(), z.number()]) }).nullable(),
  properties: z.object({
    fims_id: z.number(),
    createddate: z.string(),
    category: z.number().nullable(),
    head_category: z.number().nullable(),
    road_fr: z.string().nullable(),
    road_nl: z.string().nullable(),
    pccp: z.number().nullable(),
    status: z.string().nullable(),
    housenr: z.string().nullable(),
    comment: z.string().nullable(),
    updateddate: z.string().nullable(),
    closeddate: z.string().nullable(),
  }),
});
export const fmsCollection = z.object({ features: z.array(feature) });
export type FmsCollection = z.infer<typeof fmsCollection>;

export const fmsCodes = z.array(z.object({ value: z.number(), label_fr: z.string(), label_nl: z.string() }));
export type FmsCodes = z.infer<typeof fmsCodes>;

const HEADS: Record<number, ReportCategory> = {
  1001: "roads",
  1002: "cleanliness",
  1004: "nature",
  1005: "signs",
  1006: "lighting",
  1007: "furniture",
  1100: "monuments",
  1200: "vehicles",
};

export const CATEGORY_NAMES: Record<ReportCategory, string> = {
  roads: "Roads and pavements",
  cleanliness: "Litter and dumping",
  nature: "Trees and green spaces",
  signs: "Signs and markings",
  lighting: "Street lighting",
  furniture: "Street furniture",
  monuments: "Monuments",
  vehicles: "Abandoned vehicles",
  other: "Other problems",
};

const STATUSES: Record<string, ReportStatus> = { CREATED: "new", PROCESSING: "progress", CLOSED: "closed" };

/** The first day inside the window, as a Brussels date. */
export const firstDay = (now: number): string => addDays(dateIn(ZONE, now), -WINDOW_DAYS);

/** Normalise the region's reports to posts inside `box`, newest first. Dutch labels for Dutch readers, French otherwise. */
export function reportsFrom(raw: FmsCollection, codes: FmsCodes, box: Box, locale: string, now: number): StreetReport[] {
  const dutch = locale.toLowerCase().startsWith("nl");
  const labels = new Map(codes.map((c) => [c.value, dutch ? c.label_nl : c.label_fr]));
  const today = dateIn(ZONE, now);
  const out: StreetReport[] = [];
  for (const f of raw.features) {
    const p = f.properties;
    if (!f.geometry || !isDateOnly(p.createddate)) continue;
    const age = daysBetween(p.createddate, today);
    if (age > WINDOW_DAYS) continue;
    const [lon, lat] = f.geometry.coordinates;
    if (!inBox(box, { lat, lon })) continue;
    const kind = HEADS[p.head_category ?? 0] ?? "other";
    const street = (dutch ? p.road_nl : p.road_fr) ?? p.road_fr ?? p.road_nl;
    const category = p.category === null ? null : (labels.get(p.category) ?? null);
    out.push({
      id: `fixmystreet:${p.fims_id}`,
      source: "fixmystreet",
      kind,
      lat,
      lon,
      uncertaintyM: null,
      postedAt: p.createddate,
      seenAt: null,
      title: CATEGORY_NAMES[kind],
      subtitle: street?.trim() || null,
      photo: null,
      author: null,
      link: webUrl(`https://fixmystreet.brussels/incidents/${p.fims_id}`),
      detail: {
        category,
        status: STATUSES[p.status ?? ""] ?? "new",
        street: street?.trim() || null,
        postcode: p.pccp === null ? null : String(p.pccp),
        houseNumber: p.housenr?.trim() || null,
        comment: p.comment?.trim() || null,
        updatedOn: p.updateddate,
        closedOn: p.closeddate,
      },
    });
  }
  return out.sort((a, b) => b.postedAt.localeCompare(a.postedAt) || b.id.localeCompare(a.id));
}

function load(since: string): Promise<FmsCollection> {
  const url = new URL(WFS);
  url.search = new URLSearchParams({
    service: "wfs",
    version: "2.0.0",
    request: "GetFeature",
    typeNames: "bm_maintenance_and_planning:fims",
    outputFormat: "application/json",
    srsName: "EPSG:4326",
    propertyName: "fims_id,createddate,updateddate,closeddate,category,head_category,road_fr,road_nl,housenr,pccp,status,comment,geom",
    cql_filter: `createddate >= '${since}'`,
    sortBy: "createddate D",
    count: String(MAX_FEATURES),
  }).toString();
  return fetchJson(SOURCE, url, fmsCollection, { headers: HEADERS, timeoutMs: 25_000 });
}

export const fixmystreet: PostSource<"fixmystreet"> = {
  id: "fixmystreet",
  label: "Street reports (Fix My Street Brussels)",
  area: REGION,
  configured: () => true,
  posts: async (box, { locale, now }) => {
    if (!boxesMeet(box, REGION)) return { posts: [], capped: false };
    const since = firstDay(now);
    // The whole region in one request (about 2,500 reports, under 1 MB): fewer requests than one per map area.
    // The layer gains a day's reports at a time, so ten minutes is plenty.
    const [raw, codes] = await Promise.all([
      memo(`posts:fms:${since}`, 10 * 60_000, () => load(since)),
      diskMemo("posts-fms-categories", 7 * 24 * 3_600_000, () => fetchJson(SOURCE, CODES, fmsCodes, { headers: HEADERS }), fmsCodes),
    ]);
    return { posts: reportsFrom(raw, codes, box, locale, now), capped: raw.features.length >= MAX_FEATURES };
  },
};
