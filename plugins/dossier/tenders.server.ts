import { HttpError, fetchJson, memo, reverseGeocode, z } from "../../server/kit";
import type { Tender, Tenders } from "./types";

/**
 * What a city's public authorities are buying: the contract notices they published on TED (Tenders Electronic
 * Daily, the EU's procurement journal) in the last 30 days. TED's search API is open to anonymous callers.
 * Organisations and their contract notices appear as published.
 */

const SEARCH = "https://api.ted.europa.eu/v3/notices/search";
const WINDOW_DAYS = 30;
const FETCHED = 100;

/** The name TED's buyers write for a city is usually the local one. Photon answers in English. */
const LOCAL_NAMES: Record<string, string[]> = {
  Rome: ["Roma"],
  Milan: ["Milano"],
  Naples: ["Napoli"],
  Turin: ["Torino"],
  Florence: ["Firenze"],
  Venice: ["Venezia"],
  Genoa: ["Genova"],
  Padua: ["Padova"],
  Syracuse: ["Siracusa"],
  Brussels: ["Bruxelles", "Brussel"],
  "City of Brussels": ["Bruxelles", "Brussel"],
  Ghent: ["Gent"],
  Antwerp: ["Antwerpen", "Anvers"],
  Bruges: ["Brugge"],
  Ostend: ["Oostende"],
  Liège: ["Luik"],
  Mons: ["Bergen"],
  Namur: ["Namen"],
  Louvain: ["Leuven"],
  Vienna: ["Wien"],
  Cologne: ["Köln"],
  Munich: ["München"],
  Prague: ["Praha"],
  Lisbon: ["Lisboa"],
  Warsaw: ["Warszawa"],
  Copenhagen: ["København"],
  "The Hague": ["Den Haag", "'s-Gravenhage"],
  Athens: ["Athina", "Αθήνα"],
};

/** Letters, marks, spaces, hyphens and apostrophes only: the name goes into a query, so nothing else may pass. */
const clean = (name: string): string => name.replace(/[^\p{L}\p{M} '’-]/gu, "").trim();

export function cityNames(city: string): string[] {
  return [...new Set([city, ...(LOCAL_NAMES[city] ?? [])].map(clean).filter((n) => n.length > 1))];
}

/** The city in a place's `area` label, which reads "Esquilino, Rome" or just "Rome". */
export const cityOf = (area: string): string => area.split(",").at(-1)?.trim() ?? area;

const Notice = z.object({
  "publication-number": z.string(),
  "publication-date": z.string(),
  "notice-title": z.record(z.string(), z.string()).optional(),
  "buyer-name": z.record(z.string(), z.array(z.string())).optional(),
  "total-value": z.number().nullish(),
  "total-value-cur": z.array(z.string()).nullish(),
  "estimated-value-lot": z.array(z.string()).optional(),
  "estimated-value-cur-lot": z.array(z.string()).optional(),
  "deadline-receipt-tender-date-lot": z.array(z.string()).optional(),
  "contract-nature": z.array(z.string()).optional(),
});
const Reply = z.object({ totalNoticeCount: z.number(), notices: z.array(Notice) });

export type TedNotice = z.infer<typeof Notice>;
export type TedReply = z.infer<typeof Reply>;

const FIELDS = ["publication-number", "publication-date", "notice-title", "buyer-name", "total-value", "total-value-cur", "estimated-value-lot", "estimated-value-cur-lot", "deadline-receipt-tender-date-lot", "contract-nature"];

const day = (iso: string): string => iso.slice(0, 10);

const ENTITY: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** Notices carry HTML entities in their text: "identit&#224;" is "identità". React escapes the result, so decoding adds no markup. */
export const decodeEntities = (text: string): string =>
  text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    if (body.startsWith("#")) {
      const code = body[1] === "x" || body[1] === "X" ? Number.parseInt(body.slice(2), 16) : Number.parseInt(body.slice(1), 10);
      return Number.isInteger(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : whole;
    }
    return ENTITY[body.toLowerCase()] ?? whole;
  });

/** TED titles read "Italy – Cleaning services – the buyer's own title". The middle part is the CPV category. */
export function splitTitle(raw: string | undefined): { title: string; category: string | null } {
  const parts = decodeEntities(raw ?? "").split(" – ").map((p) => p.replace(/\s+/g, " ").trim());
  const [, category, ...rest] = parts;
  const title = (parts.length >= 3 ? rest.join(" – ") : (parts[parts.length - 1] ?? "")) || "Untitled notice";
  return { title: title.length > 240 ? `${title.slice(0, 237)}...` : title, category: parts.length >= 3 ? (category ?? null) : null };
}

const NATURE = new Set(["supplies", "services", "works"]);

export function toTender(n: TedNotice): Tender {
  const { title, category } = splitTitle(n["notice-title"]?.eng ?? Object.values(n["notice-title"] ?? {})[0]);
  const lots = n["estimated-value-lot"] ?? [];
  const lotSum = lots.map(Number).filter(Number.isFinite).reduce((a, b) => a + b, 0);
  const currencies = new Set(n["estimated-value-cur-lot"] ?? []);
  const total = n["total-value"] ?? (lotSum > 0 && currencies.size === 1 ? lotSum : null);
  const deadlines = (n["deadline-receipt-tender-date-lot"] ?? []).map(day).sort();
  const nature = n["contract-nature"]?.find((x) => NATURE.has(x));
  return {
    id: n["publication-number"],
    published: day(n["publication-date"]),
    title,
    category,
    buyer: decodeEntities(Object.values(n["buyer-name"] ?? {})[0]?.[0] ?? "Unnamed authority"),
    value: total !== null && total > 0 ? Math.round(total) : null,
    currency: n["total-value-cur"]?.[0] ?? [...currencies][0] ?? null,
    deadline: deadlines.at(-1) ?? null,
    nature: nature === "supplies" || nature === "services" || nature === "works" ? nature : null,
    url: `https://ted.europa.eu/en/notice/-/detail/${n["publication-number"]}`,
  };
}

const stamp = (ms: number): string => new Date(ms).toISOString().slice(0, 10).replaceAll("-", "");

/** TED's raw answer for a city. Cached by the caller; `tendersFrom` derives the view. */
export async function searchTed(names: string[], now = Date.now()): Promise<TedReply> {
  const since = stamp(now - WINDOW_DAYS * 86_400_000);
  const query = `buyer-city IN (${names.map((n) => `"${n}"`).join(" ")}) AND publication-date>=${since} AND notice-type=cn* SORT BY publication-number DESC`;
  return fetchJson("TED procurement search", SEARCH, Reply, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, fields: FIELDS, limit: FETCHED, page: 1, scope: "ALL" }),
    timeoutMs: 20_000,
  });
}

export const tendersFrom = (city: string, reply: TedReply): Tenders => ({ city, sinceDays: WINDOW_DAYS, total: reply.totalNoticeCount, tenders: reply.notices.map(toTender) });

/** Tenders by the authorities of the city around a point, or null where the geocoder names no city. */
export async function tendersAt(lat: number, lon: number): Promise<Tenders | null> {
  const place = await reverseGeocode(lat, lon);
  if (!place) return null;
  const city = cityOf(place.area);
  const names = cityNames(city);
  if (names.length === 0) throw new HttpError(502, "no_city", "The geocoder returned no usable city name");
  return tendersFrom(city, await memo(`ted:${names.join("|")}:${stamp(Date.now())}`, 30 * 60_000, () => searchTed(names)));
}
