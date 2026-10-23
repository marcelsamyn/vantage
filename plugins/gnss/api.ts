import { cellToBoundary } from "h3-js";
import { defineSource, diskMemo, fetchUpstream, HttpError, json, z } from "../../server/kit";
import { parseGalileoNotices, parseGalileoTable } from "./galileo.server";
import type { GalileoStatus, JamCells, Jamming } from "./types";

/**
 * GPS interference: gpsjam.org publishes one CSV a day of H3 hexagons (resolution 4) with the number of
 * aircraft that reported good and bad navigation accuracy. Galileo status: the European GNSS Service Centre.
 */

const JAM = "https://gpsjam.org/data";
const GSC = "https://www.gsc-europa.eu";

/** gpsjam.org's own rule: subtract one bad aircraft so a single faulty receiver cannot light a cell (see its FAQ). */
const SOME_PCT = 2;
const HEAVY_PCT = 10;

interface ManifestDay {
  date: string;
  suspect: boolean;
}

async function latestDay(): Promise<ManifestDay> {
  const text = await (await fetchUpstream("gpsjam.org", `${JAM}/manifest.csv`)).text();
  const rows = text.trim().split("\n").slice(1);
  const last = rows.at(-1)?.split(",");
  const date = last?.[0];
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new HttpError(502, "upstream_shape", "gpsjam.org sent a day list that VANTAGE cannot read");
  return { date, suspect: last?.[1] === "true" };
}

const StoredJamming = z.object({
  date: z.string(),
  suspect: z.boolean(),
  cells: z.object({
    type: z.literal("FeatureCollection"),
    features: z.array(
      z.object({
        type: z.literal("Feature"),
        properties: z.object({ share: z.number(), badAircraft: z.number(), goodAircraft: z.number(), level: z.enum(["some", "heavy"]) }),
        geometry: z.object({ type: z.literal("Polygon"), coordinates: z.array(z.array(z.array(z.number()))) }),
      }),
    ),
  }),
  cellsWithTraffic: z.number(),
});

const StoredGalileo = z.object({
  satellites: z.array(
    z.object({
      name: z.string(),
      svid: z.string(),
      clock: z.string(),
      health: z.enum(["healthy", "testing", "unhealthy", "unknown"]),
      statusText: z.string(),
      nagu: z.string().nullable(),
      subject: z.string().nullable(),
    }),
  ),
  notices: z.array(
    z.object({
      id: z.string(),
      subject: z.string(),
      type: z.string().nullable(),
      published: z.number(),
      start: z.number().nullable(),
      end: z.number().nullable(),
      affected: z.string().nullable(),
      url: z.string(),
    }),
  ),
});

async function loadJamming(): Promise<Jamming> {
  const day = await latestDay();
  const text = await (await fetchUpstream("gpsjam.org", `${JAM}/${day.date}-h3_4.csv`, { timeoutMs: 30_000 })).text();
  const features: JamCells["features"] = [];
  let withTraffic = 0;
  for (const line of text.trim().split("\n").slice(1)) {
    const [hex, goodText, badText] = line.split(",");
    const good = Number(goodText);
    const bad = Number(badText);
    if (!hex || !Number.isFinite(good) || !Number.isFinite(bad)) continue;
    withTraffic++;
    const share = (100 * (bad - 1)) / (good + bad);
    if (share < SOME_PCT) continue;
    // [lon, lat] rings; a cell that straddles the antimeridian would draw across the whole map, so skip it.
    const ring = cellToBoundary(hex, true).map(([lon, lat]) => [Math.round((lon ?? 0) * 1000) / 1000, Math.round((lat ?? 0) * 1000) / 1000]);
    if (Math.max(...ring.map((p) => p[0] ?? 0)) - Math.min(...ring.map((p) => p[0] ?? 0)) > 180) continue;
    features.push({
      type: "Feature",
      properties: { share: Math.round(share * 10) / 10, badAircraft: bad, goodAircraft: good, level: share > HEAVY_PCT ? "heavy" : "some" },
      geometry: { type: "Polygon", coordinates: [[...ring, ring[0] ?? [0, 0]]] },
    });
  }
  if (withTraffic === 0) throw new HttpError(502, "upstream_shape", `gpsjam.org's file for ${day.date} has no cells`);
  return { date: day.date, suspect: day.suspect, cells: { type: "FeatureCollection", features }, cellsWithTraffic: withTraffic };
}

async function loadGalileo(): Promise<GalileoStatus> {
  const [table, rss] = await Promise.all([
    fetchUpstream("Galileo service centre", `${GSC}/system-service-status/constellation-information`, { timeoutMs: 20_000 }).then((r) => r.text()),
    fetchUpstream("Galileo service centre", `${GSC}/rss.xml`, { timeoutMs: 20_000 }).then((r) => r.text()),
  ]);
  const satellites = parseGalileoTable(table);
  if (satellites.length === 0) throw new HttpError(502, "upstream_shape", "The Galileo service centre's status table has no satellites in it");
  return { satellites, notices: parseGalileoNotices(rss).slice(0, 8) };
}

export default defineSource({
  probes: [{ name: "GPS interference · gpsjam.org", url: `${JAM}/manifest.csv` }],
  routes: {
    // The file changes once a day, soon after midnight UTC.
    "GET /jamming": async () => json(await diskMemo("gnss-jamming", 3 * 3_600_000, loadJamming, StoredJamming), { maxAge: 1800 }),
    // The service centre has no API, so read its pages politely: once an hour.
    "GET /galileo": async () => json(await diskMemo("gnss-galileo", 3_600_000, loadGalileo, StoredGalileo), { maxAge: 900 }),
  },
});
