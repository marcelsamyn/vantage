import { HttpError, fetchUpstream, memo, z } from "../../server/kit";
import type { ArgoCycle, ArgoFloat, ArgoLevel, ArgoProfile } from "./types";

/**
 * Argo floats from the Coriolis data centre's ERDDAP at Ifremer. ERDDAP answers tabledap queries as CSV; the constraints
 * (>=, <=, quotes) must be percent-encoded for its Tomcat front end.
 */

const ENDPOINT = "https://erddap.ifremer.fr/erddap/tabledap/ArgoFloats.csv";
const DAY_MS = 86_400_000;
/** Floats dive about every ten days; three weeks shows each float's last two dives. */
const RECENT_DAYS = 21;
const HISTORY_DAYS = 70;
const PLATFORM = /^\d{5,8}$/;

export interface Box {
  west: number;
  south: number;
  east: number;
  north: number;
}

/** CSV with a header row and a units row. Values here never contain commas or quotes (numbers, ISO times, WMO numbers). */
function rows(text: string, columns: readonly string[]): Record<string, string>[] {
  const lines = text.trim().split("\n");
  const header = (lines[0] ?? "").split(",");
  for (const c of columns) if (!header.includes(c)) throw new HttpError(502, "upstream_shape", `Argo (Ifremer ERDDAP) sent a table without the column ${c}`);
  return lines.slice(2).map((line) => {
    const cells = line.split(",");
    return Object.fromEntries(header.map((h, i) => [h, cells[i] ?? ""]));
  });
}

const encode = (query: string): string => query.replace(/>/g, "%3E").replace(/</g, "%3C").replace(/"/g, "%22");

async function table(source: string, query: string): Promise<string | null> {
  // ERDDAP uses 404 for an empty query, so inspect its body before classifying the response.
  const res = await fetchUpstream(source, `${ENDPOINT}?${encode(query)}`, { timeoutMs: 45_000, acceptedStatuses: [404], headers: { accept: "text/csv, */*" } });
  const text = await res.text();
  if (res.ok) return text;
  if (res.status === 404 && /^Error\s*\{\s*code=404;\s*message="Not Found: Your query produced no matching results\. \(nRows = 0\)";\s*\}\s*$/.test(text)) return null;
  throw new HttpError(502, "upstream_status", `${source} answered HTTP ${res.status}`);
}

const isoSecond = (ms: number): string => new Date(ms).toISOString().slice(0, 19) + "Z";

const FloatRow = z.object({
  platform_number: z.string().regex(PLATFORM),
  cycle_number: z.coerce.number().int(),
  time: z.string(),
  latitude: z.coerce.number(),
  longitude: z.coerce.number(),
  pres: z.coerce.number(),
});

/** Floats whose last dive in the past three weeks ended inside the box. */
export function floatsIn(box: Box): Promise<ArgoFloat[]> {
  const key = `argo:box:${box.west},${box.south},${box.east},${box.north}`;
  return memo(key, 30 * 60_000, async () => {
    const since = isoSecond(Date.now() - RECENT_DAYS * DAY_MS);
    // orderByMax keeps, for each float, the row with its latest time: the deepest point of its latest dive.
    const query = `platform_number,cycle_number,time,latitude,longitude,pres&latitude>=${box.south}&latitude<=${box.north}&longitude>=${box.west}&longitude<=${box.east}&time>=${since}&orderByMax("platform_number,time")`;
    const text = await table("Argo floats · Ifremer ERDDAP", query);
    if (text === null) return [];
    return rows(text, ["platform_number", "cycle_number", "time", "latitude", "longitude", "pres"]).flatMap((raw): ArgoFloat[] => {
      const r = FloatRow.safeParse(raw);
      if (!r.success || !Number.isFinite(r.data.latitude) || !Number.isFinite(r.data.longitude)) return [];
      return [{ platform: r.data.platform_number, cycle: r.data.cycle_number, time: Date.parse(r.data.time), lat: r.data.latitude, lon: r.data.longitude, maxPresDbar: r.data.pres }];
    });
  });
}

const LevelRow = z.object({
  cycle_number: z.coerce.number().int(),
  time: z.string(),
  latitude: z.coerce.number(),
  longitude: z.coerce.number(),
  pres: z.coerce.number(),
  temp: z.coerce.number(),
  psal: z.string(),
  temp_qc: z.string(),
  pres_qc: z.string(),
});

/** Quality flags 1 (good) and 2 (probably good). Anything else is a flagged reading. */
const GOOD = new Set(["1", "2"]);

/** The good readings (quality flags 1 and 2) of a table of levels with the columns the profile query asks for. */
export function parseProfileRows(text: string): ProfileRow[] {
  const cells = rows(text, ["cycle_number", "time", "latitude", "longitude", "pres", "temp", "psal", "temp_qc", "pres_qc"]);
  return cells.flatMap((raw) => {
    const r = LevelRow.safeParse(raw);
    return r.success && GOOD.has(r.data.temp_qc) && GOOD.has(r.data.pres_qc) && [r.data.pres, r.data.temp, r.data.latitude, r.data.longitude].every(Number.isFinite) ? [r.data] : [];
  });
}

/** The latest dive of one float, and where it came up on its earlier dives. */
export function floatProfile(platform: string): Promise<ArgoProfile> {
  if (!PLATFORM.test(platform)) throw new HttpError(400, "bad_query", "An Argo float number has 5 to 8 digits.");
  return memo(`argo:profile:${platform}`, 30 * 60_000, async () => {
    const since = isoSecond(Date.now() - HISTORY_DAYS * DAY_MS);
    const query = `cycle_number,time,latitude,longitude,pres,temp,psal,temp_qc,pres_qc&platform_number="${platform}"&time>=${since}&orderBy("cycle_number,pres")`;
    const text = await table(`Argo float ${platform} · Ifremer ERDDAP`, query);
    return buildProfile(platform, text === null ? [] : parseProfileRows(text));
  });
}

export type ProfileRow = z.infer<typeof LevelRow>;

export function buildProfile(platform: string, good: readonly ProfileRow[]): ArgoProfile {
  const byCycle = new Map<number, ProfileRow[]>();
  for (const r of good) byCycle.set(r.cycle_number, [...(byCycle.get(r.cycle_number) ?? []), r]);
  const cycles = [...byCycle].sort((a, b) => a[0] - b[0]);
  const last = cycles[cycles.length - 1];
  if (!last) throw new HttpError(404, "no_profile", `Float ${platform} has no good profile in the last ${HISTORY_DAYS} days.`);
  const head = (rs: ProfileRow[]): ArgoCycle => {
    const first = rs[0] as ProfileRow;
    return { cycle: first.cycle_number, time: Date.parse(first.time), lat: first.latitude, lon: first.longitude };
  };
  const levels = last[1].map((r): ArgoLevel => ({ presDbar: r.pres, tempC: r.temp, psal: r.psal === "" || !Number.isFinite(Number(r.psal)) ? null : Number(r.psal) })).sort((a, b) => a.presDbar - b.presDbar);
  const history = cycles.slice(0, -1).map(([, rs]) => head(rs));
  const times = [...history, head(last[1])].map((c) => c.time);
  const gaps = times.slice(1).map((t, i) => (t - (times[i] ?? t)) / DAY_MS);
  const sorted = [...gaps].sort((a, b) => a - b);
  const cycleDays = sorted.length ? Math.round((sorted[Math.floor((sorted.length - 1) / 2)] ?? 0) * 10) / 10 : null;
  return { platform, latest: { ...head(last[1]), levels }, history, cycleDays };
}
