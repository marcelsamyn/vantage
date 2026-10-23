import { HttpError, diskMemo, z } from "../../server/kit";
import { downloadRomeFile, isoDate, newestResource } from "./ckan.server";
import { type WifiDay, type WifiHotspot } from "./types";

/**
 * Rome's public Wi-Fi (Digit Roma). The city publishes one row per session each day: sessions, data volume
 * and the interface language. This tallies them per hotspot.
 */

const MAX_LANGUAGES = 4;
const DAY_MS = 24 * 3_600_000;
const WEEK_MS = 7 * DAY_MS;

/** Splits one CSV line with double-quoted fields. */
function splitCsv(line: string): string[] {
  const out: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      out.push(field);
      field = "";
    } else field += c;
  }
  out.push(field);
  return out;
}

const keyOf = (...parts: string[]): string => parts.join(" ").toLowerCase().replace(/[^a-z0-9]/g, "");

interface Place {
  name: string | null;
  lat: number;
  lon: number;
}

const StoredPlaces = z.array(z.tuple([z.string(), z.object({ name: z.string().nullable(), lat: z.number(), lon: z.number() })]));

const StoredWifiDay = z.object({
  date: z.string(),
  hiddenHotspots: z.number(),
  totalSessions: z.number(),
  hotspots: z.array(
    z.object({
      id: z.string(),
      address: z.string(),
      venue: z.string().nullable(),
      municipio: z.string(),
      lat: z.number(),
      lon: z.number(),
      sessions: z.number(),
      bytes: z.number(),
      languages: z.array(z.object({ code: z.string(), share: z.number() })),
    }),
  ),
});

/** Positions of the hotspots: the city publishes each one's coverage area as a polygon, and the middle of it is the hotspot. */
function hotspotPlaces(kml: string): Map<string, Place> {
  const sums = new Map<string, { name: string | null; lat: number; lon: number; n: number }>();
  for (const [placemark] of kml.matchAll(/<Placemark[\s\S]*?<\/Placemark>/g)) {
    const field = (name: string): string => new RegExp(`name="${name}">([^<]*)<`).exec(placemark)?.[1]?.trim() ?? "";
    const key = keyOf(field("DUG"), field("DUF"), field("CIVICO"));
    if (!key) continue;
    const acc = sums.get(key) ?? { name: field("STRUTTURA") || null, lat: 0, lon: 0, n: 0 };
    for (const [, coords] of placemark.matchAll(/<coordinates>([^<]*)<\/coordinates>/g)) {
      for (const pair of (coords ?? "").trim().split(/\s+/)) {
        const [lon, lat] = pair.split(",").map(Number);
        if (lon === undefined || lat === undefined || !Number.isFinite(lon) || !Number.isFinite(lat)) continue;
        acc.lon += lon;
        acc.lat += lat;
        acc.n++;
      }
    }
    sums.set(key, acc);
  }
  const out = new Map<string, Place>();
  for (const [key, s] of sums) if (s.n > 0) out.set(key, { name: s.name, lat: s.lat / s.n, lon: s.lon / s.n });
  return out;
}

function places(): Promise<Map<string, Place>> {
  return diskMemo("dossier-wifi-places", WEEK_MS, async () => {
    const file = await newestResource("d192", (r) => r.format === "KML" && /digit_secure_map_hhc.*3035/i.test(r.name));
    const kml = new TextDecoder("utf-8").decode(await downloadRomeFile(file));
    return [...hotspotPlaces(kml)];
  }, StoredPlaces).then((entries) => new Map(entries));
}

interface Tally {
  municipio: string;
  address: string;
  sessions: number;
  bytes: number;
  languages: Map<string, number>;
}

export function wifiDay(): Promise<WifiDay> {
  return diskMemo("dossier-wifi-day", DAY_MS, async () => {
    // The yearly datasets are named wifi<year>; in early January the new one may not exist yet.
    const year = new Date().getFullYear();
    const file = await newestResource(`wifi${year}`, (r) => r.format === "CSV").catch(() => newestResource(`wifi${year - 1}`, (r) => r.format === "CSV"));
    // The city writes this file in Windows-1252, not UTF-8.
    const rows = new TextDecoder("windows-1252").decode(await downloadRomeFile(file)).split(/\r?\n/).filter((l) => l.length > 0);
    const header = splitCsv(rows[0] ?? "");
    const col = (name: string): number => {
      const i = header.indexOf(name);
      if (i < 0) throw new HttpError(502, "upstream_shape", `Rome Wi-Fi file has no ${name} column`);
      return i;
    };
    const [iDown, iUp, iMun, iDug, iDuf, iCiv, iLang] = [col("DOWNLOAD"), col("UPLOAD"), col("MUNICIPIO"), col("DUG"), col("DUF"), col("CIVICO"), col("DTLN")];

    const tally = new Map<string, Tally>();
    for (const line of rows.slice(1)) {
      const f = splitCsv(line);
      const dug = f[iDug] ?? "";
      const duf = f[iDuf] ?? "";
      const civico = f[iCiv] ?? "";
      const key = keyOf(dug, duf, civico);
      if (!key) continue;
      const t = tally.get(key) ?? { municipio: f[iMun] ?? "", address: `${dug} ${duf}, ${civico}`.replace(/\s+/g, " "), sessions: 0, bytes: 0, languages: new Map() };
      t.sessions++;
      t.bytes += (Number(f[iDown]) || 0) + (Number(f[iUp]) || 0);
      const lang = (f[iLang] ?? "").trim().toLowerCase();
      if (lang) t.languages.set(lang, (t.languages.get(lang) ?? 0) + 1);
      tally.set(key, t);
    }

    const known = await places();
    const hotspots: WifiHotspot[] = [];
    let left = 0;
    let total = 0;
    for (const [key, t] of tally) {
      total += t.sessions;
      const place = known.get(key);
      if (!place) {
        left++;
        continue;
      }
      const withLanguage = [...t.languages.values()].reduce((a, b) => a + b, 0);
      const languages = [...t.languages]
        .sort((a, b) => b[1] - a[1])
        .slice(0, MAX_LANGUAGES)
        .map(([code, n]) => ({ code, share: n / withLanguage }));
      hotspots.push({ id: key, address: t.address, venue: place.name, municipio: t.municipio, lat: place.lat, lon: place.lon, sessions: t.sessions, bytes: t.bytes, languages });
    }
    hotspots.sort((a, b) => b.sessions - a.sessions);
    return { date: isoDate(file.stamp ?? ""), hiddenHotspots: left, totalSessions: total, hotspots } satisfies WifiDay;
  }, StoredWifiDay);
}
