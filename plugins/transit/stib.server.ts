import { HttpError, diskMemo, fetchJson, memo, parseUpstream, z } from "../../server/kit";
import { distanceM } from "../../shared/geo";
import { bmcFetch, bmcTtl } from "./bmc.server";
import { titleCase } from "./http.server";
import type { LiveVehicle } from "./live.server";
import { BASE, Place } from "./transitous.server";
import type { Departure } from "./types";
import { vehicleFeed } from "./feeds.server";

/**
 * STIB-MIVB (Brussels) publishes no GTFS-RT, so Transitous only has its timetable. Its own live API gives the next
 * two arrivals of every line at every stop, and where each vehicle is: so many metres past a stop.
 */
export const STIB_SOURCE = "STIB-MIVB via Belgian Mobility open data (CC BY 4.0)";
const TRANSITOUS_PREFIX = "be-stib_";

/** STIB writes names in French and Dutch; a few carry only one of the two. */
const Text = z.object({ fr: z.string().optional(), nl: z.string().optional(), en: z.string().optional() });

/** The portal sends each stop's passing times as a JSON string inside the JSON record. */
const Passing = z.object({ lineId: z.string(), expectedArrivalTime: z.string(), destination: Text.optional(), message: Text.optional() });

const WaitingTimes = z.object({ results: z.array(z.object({ pointid: z.string(), lineid: z.string(), passingtimes: z.string() })) });

/**
 * STIB's point id for a Transitous stop id, or null for any other operator. STIB's GTFS splits some stops into
 * lettered platforms ("be-stib_3348A"); its live API knows only the number.
 */
export function stibPoint(transitousStopId: string): string | null {
  if (!transitousStopId.startsWith(TRANSITOUS_PREFIX)) return null;
  const digits = transitousStopId.slice(TRANSITOUS_PREFIX.length).replace(/\D+$/, "");
  return /^\d+$/.test(digits) ? digits : null;
}

/** "STOCKEL" and "STOKKEL" become "Stockel / Stokkel", the way the stops sign it; one name when both agree. */
function destination(t: z.infer<typeof Text> | undefined): string {
  const names = [...new Set([t?.fr, t?.nl].filter((n): n is string => Boolean(n)))];
  return names.map(titleCase).join(" / ");
}

function json(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(502, "upstream_shape", "STIB sent a response that is not JSON");
  }
}

/**
 * One departure row per predicted arrival; a prediction without a readable time is left out. Mode and colours come
 * later, from the timetable rows of the same line.
 */
export function stibRows(data: z.infer<typeof WaitingTimes>): Departure[] {
  return data.results.flatMap((r) =>
    parseUpstream("STIB", z.array(Passing), json(r.passingtimes)).flatMap((p): Departure[] => {
      const time = Date.parse(p.expectedArrivalTime);
      if (!Number.isFinite(time)) return [];
      return [
        {
          tripId: `stib:${r.pointid}:${p.lineId}:${p.expectedArrivalTime}`,
          route: p.lineId,
          headsign: destination(p.destination),
          mode: "",
          time,
          // A prediction with no timetable time beside it: the board cannot say how late it is.
          scheduled: null,
          realTime: true,
          cancelled: false,
          track: null,
          trackChanged: false,
          agency: "STIB",
          routeColor: null,
          routeTextColor: null,
          accessible: null,
          note: p.message ? (p.message.en ?? p.message.fr ?? p.message.nl ?? null) : null,
          train: null,
          occupancy: null,
        },
      ];
    }),
  );
}

/** The next live arrivals at a set of STIB points, a few lines each. */
export function stibDepartures(points: readonly string[]): Promise<Departure[]> {
  const sorted = [...new Set(points)].sort();
  if (sorted.length === 0) return Promise.resolve([]);
  return memo(`transit:stib:${sorted.join(",")}`, bmcTtl(20_000), async () => {
    const where = sorted.map((p) => `pointid="${p}"`).join(" or ");
    const res = await bmcFetch("STIB", `/datasets/stibmivb/rt/WaitingTimes?limit=100&where=${encodeURIComponent(where)}`, "application/json");
    const body = await res.text();
    return stibRows(parseUpstream("STIB", WaitingTimes, json(body)));
  });
}

const isStibTrip = (d: Departure): boolean => d.tripId.includes("_be-stib_");

/** Letters and digits only, so the timetable's "GARE DE L'OUEST" meets the prediction's "Gare De L'Ouest / Weststation". */
const plain = (s: string): string => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

/** One key per name a row's destination goes by: predictions carry the French and the Dutch name. */
const directionKeys = (d: Departure): string[] => d.headsign.split(" / ").map((name) => `${d.route}|${plain(name)}`);

/**
 * STIB predictions in place of the timetable, per line and direction, up to the last prediction for each. A
 * timetable row whose direction no prediction names stays. A prediction takes its line's mode and colours from the
 * timetable, which knows them.
 */
export function withStibPredictions(timetable: readonly Departure[], live: readonly Departure[]): Departure[] {
  const lastLive = new Map<string, number>();
  for (const d of live) for (const k of directionKeys(d)) lastLive.set(k, Math.max(d.time, lastLive.get(k) ?? 0));
  const line = new Map<string, Departure>();
  for (const d of timetable) if (isStibTrip(d) && !line.has(d.route)) line.set(d.route, d);
  const predicted = live.map((d) => {
    const t = line.get(d.route);
    return t ? { ...d, mode: t.mode, routeColor: t.routeColor, routeTextColor: t.routeTextColor } : d;
  });
  const rest = timetable.filter((d) => !isStibTrip(d) || d.time > Math.max(...directionKeys(d).map((k) => lastLive.get(k) ?? -Infinity)));
  return [...predicted, ...rest].sort((a, b) => a.time - b.time);
}

// ── Vehicles ──────────────────────────────────────────────────────

/** One direction of one line: its stops in order, with their place. */
const Line = z.object({
  line: z.string(),
  mode: z.string(),
  destination: z.string(),
  stops: z.array(z.object({ point: z.string(), lat: z.number(), lon: z.number() })),
});
type Line = z.infer<typeof Line>;

const StopsByLine = z.object({ total_count: z.number(), results: z.array(z.object({ lineid: z.string(), destination: z.string(), points: z.string() })) });
const LinePoints = z.array(z.object({ id: z.string(), order: z.number() }));
const VehiclePositions = z.object({ results: z.array(z.object({ lineid: z.string(), vehiclepositions: z.string() })) });
const Positions = z.array(z.object({ directionId: z.string(), distanceFromPoint: z.number(), pointId: z.string() }));

/** The Brussels region, where every STIB stop lies. */
export const BRUSSELS = { minLat: 50.75, minLon: 4.22, maxLat: 50.93, maxLon: 4.5 };
/** STIB ids compare without platform letters or leading zeros: the live API says "636" where the network says "0636B". */
const pointKey = (id: string): string => id.replace(/\D+$/, "").replace(/^0+(?=\d)/, "");

const PAGE = 100;

/** Both directions of every line, a page at a time: the portal returns at most 100 records per call. */
async function stopsByLine(): Promise<z.infer<typeof StopsByLine>["results"]> {
  const page = async (offset: number): Promise<z.infer<typeof StopsByLine>> => {
    const res = await bmcFetch("STIB", `/datasets/stibmivb/static/stopsByLine?limit=${PAGE}&offset=${offset}`, "application/json");
    return parseUpstream("STIB", StopsByLine, json(await res.text()));
  };
  const first = await page(0);
  const offsets = Array.from({ length: Math.ceil(first.total_count / PAGE) - 1 }, (_, i) => (i + 1) * PAGE);
  const rest = await Promise.all(offsets.map(page));
  return [first, ...rest].flatMap((p) => p.results);
}

/**
 * Every line's stops in order, placed with Transitous's copy of STIB's timetable, which uses the same stop ids. A
 * line's mode is the one most of its stops serve. The network changes with the timetable, so it is kept a day.
 */
function stibNetwork(): Promise<Line[]> {
  return diskMemo(
    "transit-stib-network",
    86_400_000,
    async () => {
      const [rows, stops] = await Promise.all([
        stopsByLine(),
        fetchJson("Transitous", `${BASE}/map/stops?min=${BRUSSELS.minLat},${BRUSSELS.minLon}&max=${BRUSSELS.maxLat},${BRUSSELS.maxLon}`, z.array(Place)),
      ]);
      const place = new Map(stops.flatMap((p) => (p.stopId?.startsWith(TRANSITOUS_PREFIX) ? [[p.stopId.slice(TRANSITOUS_PREFIX.length), p] as const] : [])));
      return rows.map((r): Line => {
        const points = parseUpstream("STIB", LinePoints, json(r.points)).sort((a, b) => a.order - b.order);
        const placed = points.flatMap((pt) => {
          const p = place.get(pt.id);
          return p ? [{ id: pt.id, p }] : [];
        });
        const modes = new Map<string, number>();
        for (const { p } of placed) for (const m of p.modes ?? []) modes.set(m, (modes.get(m) ?? 0) + 1);
        const mode = [...modes].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "BUS";
        return { line: r.lineid, mode, destination: destination(parseUpstream("STIB", Text, json(r.destination))), stops: placed.map(({ id, p }) => ({ point: pointKey(id), lat: p.lat, lon: p.lon })) };
      });
    },
    z.array(Line),
  );
}

/**
 * Place each vehicle between the stop it passed and the next one on its line, the reported distance along the
 * straight line between them. STIB names a direction by a stop at its far end, not always the last one, so the
 * direction is the one that holds the vehicle's stop, and the direction's stop too when both directions hold it.
 * A vehicle on a stop the network does not list is left out: there is nowhere to draw it.
 */
export function placeVehicles(lines: readonly Line[], data: z.infer<typeof VehiclePositions>, at: number): LiveVehicle[] {
  return data.results.flatMap((r) =>
    parseUpstream("STIB", Positions, json(r.vehiclepositions)).flatMap((v): LiveVehicle[] => {
      const point = pointKey(v.pointId);
      const towards = pointKey(v.directionId);
      const candidates = lines.filter((l) => l.line === r.lineid && l.stops.some((s) => s.point === point));
      const direction = candidates.find((l) => l.stops.some((s) => s.point === towards)) ?? candidates[0];
      const index = direction?.stops.findIndex((s) => s.point === point) ?? -1;
      const from = direction?.stops[index];
      if (!direction || !from) return [];
      const to = direction.stops[index + 1] ?? from;
      const gap = distanceM(from, to);
      const f = gap > 0 ? Math.min(1, v.distanceFromPoint / gap) : 0;
      return [
        {
          tripId: `stib:${r.lineid}:${v.directionId}:${v.pointId}:${v.distanceFromPoint}`,
          lat: from.lat + (to.lat - from.lat) * f,
          lon: from.lon + (to.lon - from.lon) * f,
          at: 0,
          receivedAt: at * 1000,
          evidence: "route-distance",
          label: direction.destination ? `Line ${r.lineid} to ${direction.destination}` : `Line ${r.lineid}`,
          route: r.lineid,
          mode: direction.mode,
          delayMin: null,
          occupancy: null,
        },
      ];
    }),
  );
}

/** Every STIB vehicle in service now. */
export function stibVehicles(): Promise<LiveVehicle[]> {
  return vehicleFeed("bxl", "transit:stib:vehicles", bmcTtl(15_000), async () => {
    const [lines, res] = await Promise.all([stibNetwork(), bmcFetch("STIB", "/datasets/stibmivb/rt/VehiclePositions?limit=100", "application/json")]);
    return placeVehicles(lines, parseUpstream("STIB", VehiclePositions, json(await res.text())), Math.floor(Date.now() / 1000));
  });
}
