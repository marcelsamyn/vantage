import { HttpError, diskMemo, fetchUpstream, memo, reverseGeocode, z } from "../../server/kit";
import { distanceM } from "../../shared/geo";
import { SHOWER_NAMES } from "./showers.server";
import type { Meteor, MeteorArea, MeteorDetail, MeteorNight, MeteorShowerCount } from "./types";

/**
 * Meteors from the Global Meteor Network (GMN, CC BY 4.0): trajectories that two or more of its
 * night-sky cameras recorded, summarised once a day in one text file.
 */

export const GMN_SOURCE = "Global Meteor Network";
export const GMN_URL = "https://globalmeteornetwork.org/data/traj_summary_data/daily/traj_summary_yesterday.txt";
const DAY_MS = 24 * 3_600_000;

/** Column positions in the summary file, checked against its header so a changed layout fails loudly. */
const COL = { id: 0, time: 2, shower: 4, speed: 59, latBeg: 63, lonBeg: 65, htBeg: 67, latEnd: 69, lonEnd: 71, htEnd: 73, duration: 75, peakMag: 76, mass: 79, cameras: 84, stations: 85 } as const;
const HEADER: Readonly<Record<number, string>> = { 0: "Unique trajectory", 4: "IAU", 59: "Vinit", 63: "LatBeg", 65: "LonBeg", 67: "HtBeg", 69: "LatEnd", 71: "LonEnd", 73: "HtEnd", 75: "Duration", 76: "Peak", 79: "Mass kg", 84: "Num", 85: "Participating" };
const COLUMNS = 86;

/** A trajectory the file lists, with its camera codes. The browser gets the stations only when a meteor is opened. */
export interface ParsedMeteor extends Meteor {
  stations: string[];
}

export interface MeteorFile {
  meteors: ParsedMeteor[];
}

const finite = z.number().finite();
const Row = z.object({
  id: z.string().regex(/^\d{14}_[A-Za-z0-9]{5}$/),
  at: finite,
  shower: z.string(),
  speedKms: finite.min(5).max(80),
  latBeg: finite.min(-90).max(90),
  lonBeg: finite.min(-180).max(180),
  htBeg: finite.min(20).max(250),
  latEnd: finite.min(-90).max(90),
  lonEnd: finite.min(-180).max(180),
  htEnd: finite.min(5).max(250),
  durationS: finite.min(0),
  peakMag: finite,
  massKg: finite.positive(),
  cameras: finite.int().min(2),
  stations: z.string(),
});

const num = (cell: string | undefined): number => (cell === undefined || cell === "" ? Number.NaN : Number(cell));

/** European bounds for "over Europe": the continent and its seas, from Iceland to the Urals' western foothills. */
export const isEurope = (lat: number, lon: number): boolean => lat >= 35 && lat <= 72 && lon >= -25 && lon <= 45;

/** Turn the summary text into meteors. Rows that are incomplete or physically impossible are dropped. */
export function parseSummary(text: string): MeteorFile {
  // The file ends its lines with "\n\r", so split on either character and skip the empty pieces.
  const rows = text.split(/[\r\n]+/);
  const head = rows.find((r) => r.startsWith("#") && r.includes("Unique trajectory"));
  if (!head) throw new HttpError(502, "upstream_shape", `${GMN_SOURCE} sent a file without its column header`);
  const names = head.replace(/^#/, "").split(";");
  for (const [index, name] of Object.entries(HEADER)) {
    if (names[Number(index)]?.trim() !== name) {
      throw new HttpError(502, "upstream_shape", `${GMN_SOURCE} changed its column layout: column ${index} is "${names[Number(index)]?.trim()}", expected "${name}"`);
    }
  }

  const meteors: ParsedMeteor[] = [];
  for (const row of rows) {
    if (row === "" || row.startsWith("#")) continue;
    const c = row.split(";").map((cell) => cell.trim());
    if (c.length < COLUMNS) continue;
    // "2026-10-06 14:53:25.904250" is UTC. JavaScript reads at most milliseconds.
    const at = Date.parse(`${(c[COL.time] ?? "").slice(0, 23).replace(" ", "T")}Z`);
    const parsed = Row.safeParse({
      id: c[COL.id],
      at,
      shower: c[COL.shower] ?? "",
      speedKms: num(c[COL.speed]),
      latBeg: num(c[COL.latBeg]),
      lonBeg: num(c[COL.lonBeg]),
      htBeg: num(c[COL.htBeg]),
      latEnd: num(c[COL.latEnd]),
      lonEnd: num(c[COL.lonEnd]),
      htEnd: num(c[COL.htEnd]),
      durationS: num(c[COL.duration]),
      peakMag: num(c[COL.peakMag]),
      massKg: num(c[COL.mass]),
      cameras: num(c[COL.cameras]),
      stations: c[COL.stations] ?? "",
    });
    if (!parsed.success) continue;
    const r = parsed.data;
    // A meteor burns downward. A row that ends above where it began has a bad fit.
    if (r.htEnd >= r.htBeg) continue;
    const shower = /^[A-Z0-9]{3}$/.test(r.shower) ? r.shower : null;
    meteors.push({
      id: r.id,
      at: r.at,
      shower,
      showerName: shower ? (SHOWER_NAMES[shower] ?? null) : null,
      begin: { lat: r.latBeg, lon: r.lonBeg, heightKm: r.htBeg },
      end: { lat: r.latEnd, lon: r.lonEnd, heightKm: r.htEnd },
      speedKms: r.speedKms,
      durationS: r.durationS,
      peakMag: r.peakMag,
      massKg: r.massKg,
      cameras: r.cameras,
      europe: isEurope(r.latBeg, r.lonBeg),
      stations: r.stations.split(",").filter((s) => s !== ""),
    });
  }
  if (meteors.length === 0) throw new HttpError(502, "upstream_shape", `${GMN_SOURCE} sent a file with no usable meteors`);
  meteors.sort((a, b) => a.at - b.at);
  return { meteors };
}

/** The file changes every six hours. One day is the cache the source asks for, and it is five megabytes. */
const StoredPoint = z.object({ lat: z.number(), lon: z.number(), heightKm: z.number() });

const StoredMeteorFile = z.object({
  meteors: z.array(
    z.object({
      id: z.string(),
      at: z.number(),
      shower: z.string().nullable(),
      showerName: z.string().nullable(),
      begin: StoredPoint,
      end: StoredPoint,
      speedKms: z.number(),
      durationS: z.number(),
      peakMag: z.number(),
      massKg: z.number(),
      cameras: z.number(),
      europe: z.boolean(),
      stations: z.array(z.string()),
    }),
  ),
});

export function loadMeteorFile(): Promise<MeteorFile> {
  return diskMemo("listen-gmn-yesterday", DAY_MS, async () => {
    const res = await fetchUpstream(GMN_SOURCE, GMN_URL, { timeoutMs: 90_000, headers: { accept: "text/plain" } });
    return parseSummary(await res.text());
  }, StoredMeteorFile);
}

function showerCounts(meteors: readonly Meteor[]): MeteorShowerCount[] {
  const counts = new Map<string, number>();
  for (const m of meteors) if (m.shower) counts.set(m.shower, (counts.get(m.shower) ?? 0) + 1);
  return [...counts]
    .map(([code, count]) => ({ code, name: SHOWER_NAMES[code] ?? code, count }))
    .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code))
    .slice(0, 8);
}

const strip = ({ stations: _stations, ...meteor }: ParsedMeteor): Meteor => meteor;

export function summarise(file: MeteorFile, area: MeteorArea): MeteorNight {
  const inArea = area === "europe" ? file.meteors.filter((m) => m.europe) : file.meteors;
  const meteors = inArea.map(strip);
  const first = file.meteors[0];
  const last = file.meteors[file.meteors.length - 1];
  let brightest: Meteor | null = null;
  let fastest: Meteor | null = null;
  for (const m of meteors) {
    if (!brightest || m.peakMag < brightest.peakMag) brightest = m;
    if (!fastest || m.speedKms > fastest.speedKms) fastest = m;
  }
  return {
    from: first?.at ?? 0,
    to: last?.at ?? 0,
    total: file.meteors.length,
    europe: file.meteors.filter((m) => m.europe).length,
    showers: showerCounts(meteors),
    meteors,
    brightest,
    fastest,
  };
}

export function meteorNight(area: MeteorArea): Promise<MeteorNight> {
  return memo(`listen:meteors:${area}`, 10 * 60_000, async () => summarise(await loadMeteorFile(), area));
}

/** Cameras that saw one meteor, and the nearest named place beneath where it began. */
export async function meteorDetail(id: string): Promise<MeteorDetail> {
  const file = await loadMeteorFile();
  const meteor = file.meteors.find((m) => m.id === id);
  if (!meteor) throw new HttpError(404, "unknown_meteor", "This meteor is not in the latest Global Meteor Network file. Files are replaced daily, so older meteors drop out.");
  // Rounded to 0.1° (about 11 km): the cache then serves the whole sky patch, and a place name needs no more.
  const lat = Math.round(meteor.begin.lat * 10) / 10;
  const lon = Math.round(meteor.begin.lon * 10) / 10;
  const place = await reverseGeocode(lat, lon).catch(() => null);
  return { id, stations: meteor.stations, over: place && distanceM({ lat, lon }, place) <= NEAR_PLACE_M ? placeLabel(place) : null };
}

/** Beyond this the nearest name is a coast or a village on another shore, not "where it was". */
const NEAR_PLACE_M = 80_000;

function placeLabel(place: { area: string; context: string }): string {
  const locality = place.area.split(", ")[0] ?? place.area;
  const country = place.context.split(", ").at(-1);
  return country && country !== locality ? `${locality}, ${country}` : locality;
}
