import { fetchJson, memo, webUrl, z } from "../../../server/kit";
import type { Box, LifeGroup, PostAuthor, PostPhoto, QualityGrade, Sighting } from "../types";
import { HEADERS, rateGate, type PostSource } from "./source.server";

/**
 * iNaturalist: people photograph a living thing and post it with its position. Observations created in the last
 * 24 hours, through the documented v2 API (https://api.inaturalist.org/v2/docs/).
 *
 * The request names the fields below: the observation, its photos with their licence and attribution text, and the
 * observer's login, name and icon. The observer's page opens on iNaturalist; VANTAGE fetches nothing else about them.
 */

const SOURCE = "iNaturalist";
const API = "https://api.inaturalist.org/v2/observations";
const FIELDS = [
  "id",
  "created_at",
  "observed_on",
  "time_observed_at",
  "location",
  "obscured",
  "geoprivacy",
  "taxon_geoprivacy",
  "public_positional_accuracy",
  "quality_grade",
  "description",
  "place_guess",
  "identifications_count",
  "num_identification_agreements",
  "faves_count",
  "comments_count",
  "taxon.name",
  "taxon.rank",
  "taxon.preferred_common_name",
  "taxon.iconic_taxon_name",
  "user.login",
  "user.name",
  "user.icon",
  "photos.url",
  "photos.license_code",
  "photos.attribution",
].join(",");
/** iNaturalist's largest page. A busy area shows its newest 200 posts of the day. */
const PER_PAGE = 200;
const WINDOW_MS = 24 * 3_600_000;
/** iNaturalist asks for at most about 60 requests a minute; VANTAGE stays well under. */
const gate = rateGate(SOURCE, 40);

const observation = z.object({
  id: z.number(),
  created_at: z.string(),
  observed_on: z.string().nullish(),
  time_observed_at: z.string().nullish(),
  location: z.string().nullish(),
  obscured: z.boolean().nullish(),
  geoprivacy: z.string().nullish(),
  taxon_geoprivacy: z.string().nullish(),
  public_positional_accuracy: z.number().nullish(),
  quality_grade: z.string().nullish(),
  description: z.string().nullish(),
  place_guess: z.string().nullish(),
  identifications_count: z.number().nullish(),
  num_identification_agreements: z.number().nullish(),
  faves_count: z.number().nullish(),
  comments_count: z.number().nullish(),
  taxon: z
    .object({
      name: z.string().nullish(),
      rank: z.string().nullish(),
      preferred_common_name: z.string().nullish(),
      iconic_taxon_name: z.string().nullish(),
    })
    .nullish(),
  user: z.object({ login: z.string().nullish(), name: z.string().nullish(), icon: z.string().nullish() }).nullish(),
  photos: z.array(z.object({ url: z.string().nullish(), license_code: z.string().nullish(), attribution: z.string().nullish() })).nullish(),
});
export const inatPage = z.object({ total_results: z.number(), results: z.array(observation) });
export type InatPage = z.infer<typeof inatPage>;
type Observation = InatPage["results"][number];

const GROUPS: Record<string, LifeGroup> = {
  Plantae: "plants",
  Fungi: "fungi",
  Aves: "birds",
  Mammalia: "vertebrates",
  Reptilia: "vertebrates",
  Amphibia: "vertebrates",
  Actinopterygii: "vertebrates",
  Insecta: "invertebrates",
  Arachnida: "invertebrates",
  Mollusca: "invertebrates",
  Animalia: "invertebrates",
};

/** iNaturalist licences carry no version in the data; iNaturalist's licence help links the 4.0 deeds. */
const LICENCES: Record<string, string> = {
  cc0: "CC0 1.0",
  "cc-by": "CC BY 4.0",
  "cc-by-nc": "CC BY-NC 4.0",
  "cc-by-sa": "CC BY-SA 4.0",
  "cc-by-nd": "CC BY-ND 4.0",
  "cc-by-nc-sa": "CC BY-NC-SA 4.0",
  "cc-by-nc-nd": "CC BY-NC-ND 4.0",
};
const ALL_RIGHTS_RESERVED = "All rights reserved";

const GRADES: Record<string, QualityGrade> = { research: "research", needs_id: "needs_id", casual: "casual" };

/** iNaturalist hides an obscured observation at a random point in a 0.2° cell; without a stated accuracy, assume its diagonal. */
function cellDiagonalM(lat: number): number {
  const dy = 0.2 * 111_320;
  const dx = 0.2 * 111_320 * Math.cos((lat * Math.PI) / 180);
  return Math.round(Math.hypot(dx, dy));
}

/** A known code in full, an unknown code as written, no code as all rights reserved. */
const licenceOf = (code: string | null | undefined): string => (code ? (LICENCES[code.toLowerCase()] ?? code.toUpperCase()) : ALL_RIGHTS_RESERVED);

/** The first photo with a web address, whatever its licence. The credit is iNaturalist's own text. */
function firstPhoto(photos: Observation["photos"]): PostPhoto | null {
  for (const p of photos ?? []) {
    const square = webUrl(p.url);
    if (!square || !square.includes("/square.")) continue;
    const url = webUrl(square.replace("/square.", "/medium."));
    if (!url) continue;
    const licence = licenceOf(p.license_code);
    return { url, thumb: square, credit: p.attribution?.trim() || `Photo: iNaturalist · ${licence}`, licence };
  }
  return null;
}

function authorOf(user: Observation["user"]): PostAuthor | null {
  const handle = user?.login || null;
  const name = user?.name || null;
  if (!handle && !name) return null;
  return {
    name,
    handle,
    profile: handle ? webUrl(`https://www.inaturalist.org/people/${encodeURIComponent(handle)}`) : null,
    avatar: webUrl(user?.icon),
  };
}

function parseLocation(location: string | null | undefined): { lat: number; lon: number } | null {
  const [lat, lon] = (location ?? "").split(",").map(Number);
  if (lat === undefined || lon === undefined || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon };
}

/** Normalise one page of observations: posts of the last 24 h with a position, newest first. */
export function sightingsFrom(raw: InatPage, now: number): Sighting[] {
  const out: Sighting[] = [];
  for (const o of raw.results) {
    const at = parseLocation(o.location);
    const postedMs = Date.parse(o.created_at);
    if (!at || !Number.isFinite(postedMs) || now - postedMs > WINDOW_MS) continue;
    const hidden = (v: string | null | undefined): boolean => v === "obscured" || v === "private";
    const approximate = o.obscured === true || hidden(o.geoprivacy) || hidden(o.taxon_geoprivacy);
    const accuracy = o.public_positional_accuracy ?? null;
    const t = o.taxon;
    const common = t?.preferred_common_name ?? null;
    const scientific = t?.name ?? null;
    out.push({
      id: `inaturalist:${o.id}`,
      source: "inaturalist",
      kind: GROUPS[t?.iconic_taxon_name ?? ""] ?? "other",
      lat: at.lat,
      lon: at.lon,
      uncertaintyM: approximate ? (accuracy ?? cellDiagonalM(at.lat)) : accuracy,
      postedAt: new Date(postedMs).toISOString(),
      seenAt: o.time_observed_at ?? o.observed_on ?? null,
      title: common ?? scientific ?? "Unidentified life",
      subtitle: common && scientific ? scientific : null,
      photo: firstPhoto(o.photos),
      author: authorOf(o.user),
      link: webUrl(`https://www.inaturalist.org/observations/${o.id}`),
      detail: {
        scientificName: scientific,
        rank: t?.rank ?? null,
        quality: GRADES[o.quality_grade ?? ""] ?? "needs_id",
        approximate,
        description: o.description?.trim() || null,
        placeGuess: o.place_guess?.trim() || null,
        identifications: o.identifications_count ?? null,
        agreements: o.num_identification_agreements ?? null,
        faves: o.faves_count ?? null,
        comments: o.comments_count ?? null,
      },
    });
  }
  return out.sort((a, b) => Date.parse(b.postedAt) - Date.parse(a.postedAt));
}

async function load(box: Box, locale: string, now: number): Promise<InatPage> {
  gate();
  const url = new URL(API);
  url.search = new URLSearchParams({
    swlat: String(box.south),
    swlng: String(box.west),
    nelat: String(box.north),
    nelng: String(box.east),
    // A minute's slack so a post on the edge of the window is never missed between cache refreshes.
    created_d1: new Date(now - WINDOW_MS - 60_000).toISOString(),
    order_by: "created_at",
    order: "desc",
    per_page: String(PER_PAGE),
    locale,
    fields: FIELDS,
  }).toString();
  return fetchJson(SOURCE, url, inatPage, { headers: HEADERS, timeoutMs: 15_000 });
}

export const inaturalist: PostSource<"inaturalist"> = {
  id: "inaturalist",
  label: "Nature sightings (iNaturalist)",
  area: null,
  configured: () => true,
  posts: async (box, { locale, now }) => {
    // Two minutes: new posts arrive one by one, and a busy view asks once per refresh, not once per viewer.
    const raw = await memo(`posts:inat:${locale}:${box.west},${box.south},${box.east},${box.north}`, 2 * 60_000, () => load(box, locale, now));
    return { posts: sightingsFrom(raw, now), capped: raw.total_results > raw.results.length };
  },
};
