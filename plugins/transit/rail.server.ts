import { diskMemo, fetchJson, z } from "../../server/kit";
import { IDENTITY } from "./http.server";
import type { LevelCrossing, RailWork, RailWorks } from "./types";

/**
 * Infrabel, the Belgian rail network manager, publishes its planned track restrictions (the long-term plan of
 * "temporary capacity restrictions") and the position of every level crossing as open data under CC0.
 * Both are static files refreshed daily or less, so the raw rows are cached and everything else is derived per request.
 */

const BASE = "https://opendata.infrabel.be/api/explore/v2.1/catalog/datasets";
export const INFRABEL_PROBE = `${BASE}/geoow/records?limit=1`;
const HEADERS = { "user-agent": IDENTITY };

/** The plan reaches two years ahead and holds thousands of one-night closures. The map shows what is about to matter. */
export const WORKS_HORIZON_DAYS = 120;

const Shape = z.object({ geometry: z.object({ type: z.literal("MultiLineString"), coordinates: z.array(z.array(z.tuple([z.number(), z.number()]))) }) });

const WorkRow = z.object({
  id: z.number(),
  line: z.string(),
  tracks: z.string().nullable(),
  date_begin: z.string(),
  date_end: z.string(),
  time_begin: z.string().nullable(),
  time_end: z.string().nullable(),
  continuity: z.string().nullable(),
  impact_level: z.string().nullable(),
  impact_description: z.string().nullable(),
  start_commercialname_dutch: z.string().nullable(),
  end_commercialname_dutch: z.string().nullable(),
  details_geo_shape: Shape.nullable(),
});
export type WorkRow = z.infer<typeof WorkRow>;

const CrossingRow = z.object({
  fld_naam_ramses: z.string(),
  type_lc: z.string().nullable(),
  fld_postcode_en_gemeente: z.string().nullable(),
  position_du_passage_a_niveau: z.object({ lat: z.number(), lon: z.number() }).nullable(),
});

const WORK_FIELDS = "id,line,tracks,date_begin,date_end,time_begin,time_end,continuity,impact_level,impact_description,start_commercialname_dutch,end_commercialname_dutch,details_geo_shape";

const dateIso = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/** Raw rows of the long-term plan that overlap the next `WORKS_HORIZON_DAYS` days. One request returns them all. */
export async function fetchWorkRows(today: string): Promise<WorkRow[]> {
  const horizon = dateIso(Date.parse(today) + WORKS_HORIZON_DAYS * 86_400_000);
  const params = new URLSearchParams({
    where: `logically_deleted='No' and date_end>=date'${today}' and date_begin<=date'${horizon}'`,
    select: WORK_FIELDS,
  });
  return fetchJson("Infrabel planned works", `${BASE}/langetermijnplanning-tcr-spoornetwerk/exports/json?${params}`, z.array(WorkRow), { headers: HEADERS, timeoutMs: 30_000 });
}

/** Today's calendar date in Belgium, where the plan's dates are kept. UTC would lag two hours behind after midnight. */
export const brusselsDay = (now: number): string => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Brussels", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);

/** The plan changes once a day. The rows sit under one cache key, so no file piles up per day; "started" is worked out on each call. */
export async function currentWorks(now = Date.now()): Promise<RailWorks> {
  const today = brusselsDay(now);
  return buildWorks(await diskMemo("infrabel-works", 3 * 3_600_000, () => fetchWorkRows(today), z.array(WorkRow)), today);
}

/** One row per restriction, strongest and soonest first. Rows without a shape cannot be drawn and are left out. */
export function buildWorks(rows: readonly WorkRow[], today: string): RailWorks {
  const seen = new Set<string>();
  const works: RailWork[] = [];
  for (const r of rows) {
    if (!r.details_geo_shape) continue;
    const id = `${r.id}-${r.line}-${r.date_begin}-${r.time_begin ?? ""}`;
    if (seen.has(id)) continue;
    seen.add(id);
    works.push({
      id,
      line: r.line,
      tracks: r.tracks ?? "",
      first: r.date_begin,
      last: r.date_end,
      timeFrom: r.time_begin?.slice(0, 5) ?? "",
      timeTo: r.time_end?.slice(0, 5) ?? "",
      continuity: r.continuity ?? "",
      impact: r.impact_level === "Major" ? "Major" : "Minor",
      effect: r.impact_description ?? "Restriction",
      start: r.start_commercialname_dutch,
      end: r.end_commercialname_dutch,
      shape: r.details_geo_shape.geometry.coordinates,
      started: r.date_begin <= today,
    });
  }
  const rank = (w: RailWork): number => (w.impact === "Major" ? 0 : 2) + (w.started ? 0 : 1);
  return { horizonDays: WORKS_HORIZON_DAYS, works: works.sort((a, b) => rank(a) - rank(b) || a.first.localeCompare(b.first)) };
}

/** Shortest distance in metres from a point to a polyline, on a flat map around the point (fine for a few kilometres). */
export function distanceToLineM(at: { lat: number; lon: number }, line: readonly (readonly [number, number])[]): number {
  const kx = Math.cos((at.lat * Math.PI) / 180) * 111_320;
  const ky = 110_540;
  const pts = line.map(([lon, lat]) => ({ x: (lon - at.lon) * kx, y: (lat - at.lat) * ky }));
  let best = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[i + 1] ?? a;
    if (!a || !b) continue;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(a.x * dx + a.y * dy) / len2));
    best = Math.min(best, Math.hypot(a.x + t * dx, a.y + t * dy));
  }
  return best;
}

/** Restrictions whose track runs within `radiusM` of a point, nearest first. */
export function worksNear(works: readonly RailWork[], at: { lat: number; lon: number }, radiusM: number): { work: RailWork; distanceM: number }[] {
  return works
    .map((work) => ({ work, distanceM: Math.round(Math.min(...work.shape.map((part) => distanceToLineM(at, part)))) }))
    .filter((w) => w.distanceM <= radiusM)
    .sort((a, b) => a.distanceM - b.distanceM);
}

export async function fetchCrossings(): Promise<LevelCrossing[]> {
  const params = new URLSearchParams({ select: "fld_naam_ramses,type_lc,fld_postcode_en_gemeente,position_du_passage_a_niveau" });
  // The list was last revised in 2022: a week in the disk cache costs nothing.
  const rows = await diskMemo("infrabel-crossings", 7 * 86_400_000, () => fetchJson("Infrabel level crossings", `${BASE}/geoow/exports/json?${params}`, z.array(CrossingRow), { headers: HEADERS, timeoutMs: 30_000 }), z.array(CrossingRow));
  return rows.flatMap((r) =>
    r.position_du_passage_a_niveau ? [{ id: r.fld_naam_ramses, lat: r.position_du_passage_a_niveau.lat, lon: r.position_du_passage_a_niveau.lon, kind: r.type_lc ?? "Level crossing", place: r.fld_postcode_en_gemeente ?? "" }] : [],
  );
}
