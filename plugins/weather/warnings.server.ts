import { diskMemo, fetchJson, memo, reverseGeocode, z } from "../../server/kit";
import { contains, ITALY_REGIONS, joinOutlines, nutsOutlines, StoredOutline, thinOutline } from "./regions.server";
import type { OfficialWarning, OfficialWarnings, WarningArea, WarningLevel } from "./types";

/**
 * Official warnings, from two public sources:
 *  - MeteoAlarm (EUMETNET): one JSON feed per country, terms equivalent to CC BY 4.0 with extra rules for redistributing.
 *  - Italy's Civil Protection Department (DPC): hydro-geological and thunderstorm alerts per warning zone,
 *    published on GitHub under CC BY 4.0, with the zone outline and the municipalities in it.
 */

const FEEDS = "https://feeds.meteoalarm.org/api/v1/warnings";

/** MeteoAlarm feed names by country. Feeds exist only for the countries listed here. */
const FEED_BY_COUNTRY: Record<string, string> = {
  AT: "austria",
  BE: "belgium",
  BG: "bulgaria",
  CH: "switzerland",
  CY: "cyprus",
  CZ: "czechia",
  DE: "germany",
  DK: "denmark",
  EE: "estonia",
  ES: "spain",
  FI: "finland",
  FR: "france",
  GB: "united-kingdom",
  GR: "greece",
  HR: "croatia",
  HU: "hungary",
  IE: "ireland",
  IS: "iceland",
  IT: "italy",
  LT: "lithuania",
  LU: "luxembourg",
  LV: "latvia",
  ME: "montenegro",
  MT: "malta",
  NL: "netherlands",
  NO: "norway",
  PL: "poland",
  PT: "portugal",
  RO: "romania",
  RS: "serbia",
  SE: "sweden",
  SI: "slovenia",
  SK: "slovakia",
};

export const SUPPORTED_COUNTRIES = Object.keys(FEED_BY_COUNTRY);

const LEVELS: Record<number, WarningLevel> = { 2: "yellow", 3: "orange", 4: "red" };

const HAZARDS: Record<string, string> = {
  wind: "Wind",
  "snow-ice": "Snow and ice",
  thunderstorm: "Thunderstorms",
  fog: "Fog",
  "high-temperature": "Extreme heat",
  "low-temperature": "Extreme cold",
  coastalevent: "Coastal event",
  "forest-fire": "Forest fire",
  avalanches: "Avalanches",
  rain: "Rain",
  flooding: "Flooding",
  "rain-flood": "Rain and flooding",
  "marine-hazard": "Marine hazard",
  drought: "Drought",
};

// ── MeteoAlarm ────────────────────────────────────────────────────

const Param = z.object({ valueName: z.string(), value: z.string() });
const Info = z.object({
  language: z.string(),
  headline: z.string().optional(),
  description: z.string().optional(),
  instruction: z.string().optional(),
  onset: z.string().optional(),
  effective: z.string().optional(),
  expires: z.string().optional(),
  senderName: z.string().optional(),
  web: z.string().optional(),
  area: z.array(z.object({ areaDesc: z.string(), geocode: z.array(Param).default([]) })).default([]),
  parameter: z.array(Param).default([]),
});
const Feed = z.object({
  warnings: z.array(z.object({ alert: z.object({ identifier: z.string(), sent: z.string(), status: z.string(), msgType: z.string(), info: z.array(Info).default([]) }) })),
});

/**
 * Feed texts can carry a legal disclaimer in brackets and arrive in capitals. The disclaimer is shown once
 * in the profile instead, and shouting is turned down to sentence case.
 */
function plain(text: string | undefined): string | null {
  const trimmed = text?.replace(/\s*\(\s*DISCLAIMER:[\s\S]*\)\s*$/i, "").trim();
  if (!trimmed) return null;
  const letters = trimmed.replace(/[^A-Za-z]/g, "");
  const upper = letters.replace(/[^A-Z]/g, "").length;
  if (letters.length < 8 || upper / letters.length < 0.7) return trimmed;
  return trimmed.toLowerCase().replace(/(^|[.!?]\s+)(\w)/g, (_, gap: string, c: string) => gap + c.toUpperCase());
}

/** Feed links end up in an anchor in the browser, so only https links pass. */
function webLink(url: string | undefined): string | null {
  return url?.startsWith("https://") ? url : null;
}

const ms = (iso: string | undefined): number | null => {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isNaN(t) ? null : t;
};

interface Candidate {
  warning: OfficialWarning;
  sent: number;
  geocodes: { name: string; value: string }[];
}

function candidates(country: string, feed: z.infer<typeof Feed>, now: number): Candidate[] {
  const out: Candidate[] = [];
  for (const { alert } of feed.warnings) {
    // Cancellations and exercises are not warnings anyone should act on.
    if (alert.status !== "Actual" || alert.msgType === "Cancel") continue;
    const info = alert.info.find((i) => i.language.toLowerCase().startsWith("en")) ?? alert.info[0];
    if (!info) continue;
    const param = (name: string): string | undefined => info.parameter.find((p) => p.valueName === name)?.value;
    const levelNumber = Number(param("awareness_level")?.split(";")[0]);
    const level = LEVELS[levelNumber];
    const until = ms(info.expires);
    const from = ms(info.onset) ?? ms(info.effective) ?? ms(alert.sent);
    if (!level || until === null || from === null || until <= now) continue;
    const rawHazard = param("awareness_type")?.split(";")[1]?.trim() ?? "Weather";
    const hazard = HAZARDS[rawHazard.toLowerCase()] ?? rawHazard;
    info.area.forEach((area, n) => {
      out.push({
        sent: ms(alert.sent) ?? 0,
        geocodes: area.geocode.map((g) => ({ name: g.valueName, value: g.value })),
        warning: {
          id: `meteoalarm:${alert.identifier}:${n}:${hazard}`,
          source: "meteoalarm",
          level,
          hazard,
          area: area.areaDesc,
          country,
          issuer: info.senderName ?? "MeteoAlarm",
          from: Math.floor(from / 1000),
          until: Math.floor(until / 1000),
          text: plain(info.description),
          advice: plain(info.instruction),
          url: webLink(info.web),
          municipalityCount: null,
          areaId: null,
        },
      });
    });
  }
  // An update can arrive before the alert it replaces expires; keep the newest for each place, hazard and start time.
  const newest = new Map<string, Candidate>();
  for (const c of out) {
    const key = `${c.warning.area}|${c.warning.hazard}|${c.warning.from}`;
    const seen = newest.get(key);
    if (!seen || c.sent > seen.sent) newest.set(key, c);
  }
  return [...newest.values()];
}

async function meteoalarm(country: string, now: number): Promise<Candidate[]> {
  const slug = FEED_BY_COUNTRY[country];
  if (!slug) return [];
  const feed = await memo(`weather:meteoalarm:${country}`, 10 * 60_000, () => fetchJson(`MeteoAlarm ${country}`, `${FEEDS}/feeds-${slug}`, Feed, { timeoutMs: 25_000 }));
  return candidates(country, feed, now);
}

// ── Italy: Civil Protection Department ────────────────────────────

const GITHUB = "https://api.github.com/repos/pcm-dpc/DPC-Bollettini-Criticita-Idrogeologica-Idraulica";
const RAW = "https://raw.githubusercontent.com/pcm-dpc/DPC-Bollettini-Criticita-Idrogeologica-Idraulica/master/files/geojson";
const DPC_ABOUT = "https://rischi.protezionecivile.gov.it/it/approfondimento/rischio-meteo-idro-lallertamento";

const Commits = z.array(z.object({ sha: z.string().regex(/^[0-9a-f]{40}$/) }));
const Commit = z.object({ files: z.array(z.object({ filename: z.string() })).default([]) });

const StoredBulletin = z.object({ stamp: z.string(), today: z.string(), tomorrow: z.string() });

interface Bulletin {
  /** "YYYYMMDD_HHMM", the publication time on the file name. */
  stamp: string;
  today: string;
  tomorrow: string;
}

/** The newest bulletin is the newest commit that adds both its "today" and "tomorrow" files. */
async function latestBulletin(): Promise<Bulletin> {
  const commits = await fetchJson("GitHub (DPC bulletins)", `${GITHUB}/commits?path=files/geojson&per_page=6`, Commits, { headers: { accept: "application/vnd.github+json" } });
  const files = new Map<string, { today?: string; tomorrow?: string }>();
  for (const c of commits) {
    const detail = await fetchJson("GitHub (DPC bulletins)", `${GITHUB}/commits/${c.sha}`, Commit, { headers: { accept: "application/vnd.github+json" } });
    for (const f of detail.files) {
      const m = f.filename.match(/files\/geojson\/(\d{8}_\d{4})_(today|tomorrow)\.json$/);
      if (!m?.[1] || !m[2]) continue;
      const entry = files.get(m[1]) ?? {};
      entry[m[2] as "today" | "tomorrow"] = f.filename.split("/").pop();
      files.set(m[1], entry);
    }
    const complete = [...files].find(([, e]) => e.today && e.tomorrow);
    if (complete?.[1].today && complete[1].tomorrow) return { stamp: complete[0], today: complete[1].today, tomorrow: complete[1].tomorrow };
  }
  throw new Error("GitHub lists no complete DPC bulletin among the newest commits");
}

const Zones = z.object({
  features: z.array(
    z.object({
      properties: z.object({
        "Nome zona": z.string(),
        "Per rischio idraulico": z.string(),
        "Per rischio temporali": z.string(),
        "Per rischio idrogeologico": z.string(),
        Comuni: z.array(z.string()).default([]),
      }),
      geometry: z.union([z.object({ type: z.literal("Polygon"), coordinates: z.array(z.array(z.tuple([z.number(), z.number()]))) }), z.object({ type: z.literal("MultiPolygon"), coordinates: z.array(z.array(z.array(z.tuple([z.number(), z.number()])))) })]),
    }),
  ),
});

interface DpcZone {
  name: string;
  municipalities: string[];
  /** Alert text per risk, only for risks above green. */
  risks: { hazard: string; level: WarningLevel; criticality: string }[];
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon;
}

const StoredZone = z.object({
  name: z.string(),
  municipalities: z.array(z.string()),
  risks: z.array(z.object({ hazard: z.string(), level: z.enum(["yellow", "orange", "red"]), criticality: z.string() })),
  geometry: StoredOutline,
});

const RISKS = [
  ["Per rischio idrogeologico", "Landslides and flash floods"],
  ["Per rischio idraulico", "River flooding"],
  ["Per rischio temporali", "Thunderstorms"],
] as const;

const CRITICALITY: Record<string, string> = { Ordinaria: "Ordinary", Moderata: "Moderate", Elevata: "High" };

function dpcLevel(text: string): { level: WarningLevel; criticality: string } | null {
  const level: WarningLevel | null = text.includes("ROSSA") ? "red" : text.includes("ARANCIONE") ? "orange" : text.includes("GIALLA") ? "yellow" : null;
  if (!level) return null;
  const word = text.split(" ")[0] ?? "";
  return { level, criticality: CRITICALITY[word] ?? word };
}

async function dpcZones(file: string, stamp: string, which: string): Promise<DpcZone[]> {
  return diskMemo(`weather-dpc-${stamp}-${which}`, 24 * 3_600_000, async () => {
    // The file is about 5 MB; only zones with an alert are kept.
    const data = await fetchJson("DPC bulletin", `${RAW}/${file}`, Zones, { timeoutMs: 60_000 });
    const zones: DpcZone[] = [];
    for (const f of data.features) {
      const p = f.properties;
      const risks = RISKS.flatMap(([key, hazard]) => {
        const r = dpcLevel(p[key]);
        return r ? [{ hazard, ...r }] : [];
      });
      if (risks.length === 0) continue;
      const geometry = thinOutline(f.geometry);
      zones.push({ name: p["Nome zona"], municipalities: p.Comuni, risks, geometry });
    }
    return zones;
  }, z.array(StoredZone));
}

/** Midnight in Rome on a calendar date, as a Unix time in ms. Rome and Brussels share one time zone. */
function localMidnight(date: string): number {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const guess = Date.UTC(y, m - 1, d);
  const offset = new Intl.DateTimeFormat("en", { timeZone: "Europe/Rome", timeZoneName: "longOffset" }).formatToParts(guess).find((p) => p.type === "timeZoneName")?.value ?? "GMT+01:00";
  const [, sign = "+", hh = "01", mm = "00"] = offset.match(/GMT([+-])(\d\d):?(\d\d)?/) ?? [];
  return guess - (sign === "-" ? -1 : 1) * (Number(hh) * 60 + Number(mm)) * 60_000;
}

const addDay = (date: string): string => new Date(Date.parse(`${date}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

/** Municipalities in one warning zone of the current bulletin. */
export async function zoneMunicipalities(zone: string): Promise<string[]> {
  const bulletin = await diskMemo("weather-dpc-latest", 45 * 60_000, latestBulletin, StoredBulletin);
  const names = new Set<string>();
  for (const [which, file] of [["today", bulletin.today], ["tomorrow", bulletin.tomorrow]] as const) {
    const hit = (await dpcZones(file, bulletin.stamp, which)).find((z) => z.name === zone);
    for (const m of hit?.municipalities ?? []) names.add(m);
  }
  return [...names].sort((a, b) => a.localeCompare(b, "it"));
}

interface DpcResult {
  warnings: OfficialWarning[];
  outlines: Map<string, WarningArea["geometry"]>;
}

async function dpc(now: number): Promise<DpcResult> {
  const bulletin = await diskMemo("weather-dpc-latest", 45 * 60_000, latestBulletin, StoredBulletin);
  const date = `${bulletin.stamp.slice(0, 4)}-${bulletin.stamp.slice(4, 6)}-${bulletin.stamp.slice(6, 8)}`;
  const days = [
    { which: "today", file: bulletin.today, date },
    { which: "tomorrow", file: bulletin.tomorrow, date: addDay(date) },
  ] as const;
  const warnings: OfficialWarning[] = [];
  const outlines = new Map<string, WarningArea["geometry"]>();
  for (const day of days) {
    const from = localMidnight(day.date);
    const until = localMidnight(addDay(day.date));
    if (until <= now) continue;
    for (const zone of await dpcZones(day.file, bulletin.stamp, day.which)) {
      const areaId = `dpc:${zone.name}`;
      outlines.set(areaId, zone.geometry);
      for (const risk of zone.risks) {
        warnings.push({
          id: `dpc:${bulletin.stamp}:${day.which}:${zone.name}:${risk.hazard}`,
          source: "dpc",
          level: risk.level,
          hazard: risk.hazard,
          area: zone.name,
          country: "IT",
          issuer: "Dipartimento della Protezione Civile",
          from: Math.floor(from / 1000),
          until: Math.floor(until / 1000),
          text: `${risk.criticality} criticality is expected in this warning zone.`,
          advice: "Follow the instructions of your municipality and regional civil protection.",
          url: DPC_ABOUT,
          municipalityCount: zone.municipalities.length,
          areaId,
        });
      }
    }
  }
  return { warnings, outlines };
}

// ── Assembly ──────────────────────────────────────────────────────

const RANK: Record<WarningLevel, number> = { yellow: 1, orange: 2, red: 3 };

/** Country of a position, or null when it cannot be told. */
async function countryAt(lat: number, lon: number): Promise<string | null> {
  const place = await reverseGeocode(lat, lon).catch(() => null);
  return place?.countryCode ?? null;
}

export async function loadWarnings(here: { lat: number; lon: number } | null): Promise<OfficialWarnings> {
  const now = Date.now();
  const own = here ? await countryAt(here.lat, here.lon) : null;
  const countries = [...new Set(["IT", "BE", ...(own && own in FEED_BY_COUNTRY ? [own] : [])])];

  const [nuts, italian, ...feeds] = await Promise.allSettled([nutsOutlines(), dpc(now), ...countries.map((c) => meteoalarm(c, now))]);
  const failed: OfficialWarnings["failed"] = [];
  const note = (source: string, r: PromiseRejectedResult): void => void failed.push({ source, message: r.reason instanceof Error ? r.reason.message : String(r.reason) });

  const outlines = new Map<string, WarningArea["geometry"]>();
  const warnings: OfficialWarning[] = [];
  const nutsById = nuts.status === "fulfilled" ? nuts.value : {};
  if (nuts.status === "rejected") note("Eurostat region outlines", nuts);

  feeds.forEach((r, i) => {
    if (r.status === "rejected") return note(`MeteoAlarm ${countries[i] ?? ""}`, r);
    for (const c of r.value) {
      const code = c.geocodes.find((g) => g.name === "NUTS3")?.value ?? c.geocodes.find((g) => g.name === "NUTS2")?.value;
      const italy = c.geocodes.find((g) => g.name === "EMMA_ID" && g.value in ITALY_REGIONS)?.value;
      let areaId: string | null = null;
      if (code && nutsById[code]) {
        areaId = `nuts:${code}`;
        outlines.set(areaId, nutsById[code]);
      } else if (italy) {
        const joined = joinOutlines((ITALY_REGIONS[italy] ?? []).flatMap((id) => (nutsById[id] ? [nutsById[id]] : [])));
        if (joined) {
          areaId = `it:${italy}`;
          outlines.set(areaId, joined);
        }
      }
      warnings.push({ ...c.warning, areaId });
    }
  });

  if (italian.status === "rejected") note("Italian Civil Protection (DPC)", italian);
  else {
    warnings.push(...italian.value.warnings);
    for (const [id, g] of italian.value.outlines) outlines.set(id, g);
  }

  warnings.sort((a, b) => RANK[b.level] - RANK[a.level] || a.from - b.from);
  const covering = here
    ? warnings.filter((w) => w.areaId && w.from * 1000 <= now + 12 * 3_600_000 && contains(outlines.get(w.areaId) ?? { type: "Polygon", coordinates: [] }, here.lat, here.lon)).map((w) => w.id)
    : [];
  const used = new Set(warnings.flatMap((w) => (w.areaId ? [w.areaId] : [])));
  return {
    fetchedAt: Math.floor(now / 1000),
    countries,
    warnings,
    areas: [...outlines].filter(([id]) => used.has(id)).map(([id, geometry]) => ({ id, geometry })),
    covering,
    failed,
  };
}
