import { HttpError, defineSource, fetchJson, json, lat, lon, log, memo, parseQuery, z } from "../../server/kit";
import { mergeAlerts } from "./alerts.server";
import { IRAIL_PROBE, IRAIL_SOURCE, iRailStationId, iRailVehicleId, irailDepartures, irailNear, irailTrain, isNearBelgium } from "./irail.server";
import { nationalReports, nationalSources } from "./live.server";
import { transitClock, vehicleFeed } from "./feeds.server";
import { transitSnapshot, updateVehicles, vehicleTracker } from "./tracking.server";
import { decodePolyline } from "./geometry";
import { INFRABEL_PROBE, currentWorks, fetchCrossings, worksNear } from "./rail.server";
import { ROME_PROBE, ROME_SOURCE, atacTripId, romeReports, romeVehicles } from "./rome.server";
import { STIB_SOURCE, stibDepartures, stibPoint, withStibPredictions } from "./stib.server";
import { BASE, Place, TRANSITOUS_SOURCE, ref, transitousAreaAlerts, transitousBoard, transitousRoute, transitousTrip } from "./transitous.server";
import { isTransitousTrip } from "./trip-id";
import type { Board, Departure, TrainDetail, TrainMatch, TransitAlert, TransitStop, TripSegment, TransitSnapshot } from "./types";
import { VT_PROBE, VT_SOURCE, vtDepartures, vtFindRuns, vtResolve, vtStationCode, vtTrain } from "./viaggiatreno.server";

const Segment = z.object({
  trips: z.array(z.object({ tripId: z.string(), routeShortName: z.string().optional() })),
  mode: z.string(),
  from: Place,
  to: Place,
  departure: z.string(),
  arrival: z.string(),
  scheduledArrival: z.string(),
  realTime: z.boolean(),
  polyline: z.string(),
});


const bbox = z.object({ minLat: lat, minLon: lon, maxLat: lat, maxLon: lon });
const snap = (v: number): number => Math.round(v * 100) / 100;

/** Rome and its surroundings: where ATAC's occupancy feed applies. */
const ROME_AREA = { minLat: 41.6, minLon: 12.2, maxLat: 42.2, maxLon: 12.9 };
const inRome = (b: z.infer<typeof bbox>): boolean => b.minLat <= ROME_AREA.maxLat && b.maxLat >= ROME_AREA.minLat && b.minLon <= ROME_AREA.maxLon && b.maxLon >= ROME_AREA.minLon;

/** A board shows the worst few alerts; the operator's page has the rest. */
const BOARD_ALERTS = 6;

const isRail = (d: Departure): boolean => /RAIL|TRAIN|METRO/.test(d.mode);

/**
 * The board for one stop. Italian and Belgian rail stations use their national feed for delays and platforms, and
 * Brussels STIB stops use STIB's own predictions; each falls back to Transitous with a notice if that feed fails.
 */
async function buildBoard(stopId: string): Promise<Board> {
  const { stopIds, ...base } = await transitousBoard(stopId);
  const board: Board = { ...base, source: TRANSITOUS_SOURCE, notice: null };

  const vtCode = vtStationCode(stopId);
  const irailId = iRailStationId(stopId);
  if (stibPoint(stopId)) {
    try {
      const live = await stibDepartures(stopIds.flatMap((id) => stibPoint(id) ?? []));
      board.departures = withStibPredictions(base.departures, live);
      board.source = `${STIB_SOURCE}, with Transitous timetables`;
    } catch (err) {
      log.warn("STIB board failed", { stopId, error: err instanceof Error ? err.message : String(err) });
      board.notice = "Live STIB times are unavailable, so STIB lines show timetable times.";
    }
  } else if (vtCode) {
    try {
      const live = await vtDepartures(vtCode);
      const lastLive = live.reduce((t, d) => Math.max(t, d.time), 0);
      // The Italian feed lists the next hour or two; the timetable carries on after it. Buses and other agencies stay.
      const rest = base.departures.filter((d) => (isRail(d) ? d.time > lastLive : true));
      board.departures = [...live, ...rest].sort((a, b) => a.time - b.time);
      board.source = `${VT_SOURCE}, with Transitous timetables`;
    } catch (err) {
      log.warn("ViaggiaTreno board failed", { stopId, error: err instanceof Error ? err.message : String(err) });
      board.notice = "Live train data from ViaggiaTreno is unavailable, so these are timetable times.";
    }
  } else if (irailId) {
    try {
      const live = await irailDepartures(irailId);
      const lastLive = live.departures.reduce((t, d) => Math.max(t, d.time), 0);
      const rest = base.departures.filter((d) => (isRail(d) ? d.time > lastLive : true));
      board.departures = [...live.departures, ...rest].sort((a, b) => a.time - b.time);
      board.source = `${IRAIL_SOURCE}, with Transitous timetables`;
    } catch (err) {
      log.warn("iRail board failed", { stopId, error: err instanceof Error ? err.message : String(err) });
      board.notice = "Live train data from iRail is unavailable, so these are timetable times.";
    }
    try {
      // iRail words national rail disruptions for travellers; Transitous carries the operators' own notices per line.
      board.alerts = mergeAlerts(await irailNear(board.stop.lat, board.stop.lon), base.alerts);
    } catch (err) {
      log.warn("iRail alerts failed", { stopId, error: err instanceof Error ? err.message : String(err) });
      board.notice ??= "Service alerts from iRail are unavailable.";
    }
  }
  return { ...board, alerts: board.alerts.slice(0, BOARD_ALERTS) };
}

const TrainQuery = z.discriminatedUnion("country", [
  z.object({ country: z.literal("IT"), number: z.coerce.number().int().min(1).max(99_999), origin: z.string().regex(/^S\d{5}$/).optional(), date: z.coerce.number().int().optional() }),
  z.object({ country: z.literal("BE"), id: z.string().regex(/^BE\.NMBS\.[A-Z]{1,4}\d{2,5}$/) }),
]);

async function buildMapSnapshot(q: z.infer<typeof bbox> & { zoom: number }, focus?: string): Promise<TransitSnapshot> {
  const startedAt = transitClock.now();
  if (q.maxLat <= q.minLat || q.maxLon <= q.minLon) throw new HttpError(400, "invalid_bounds", "Map bounds must have positive width and height");
  if (q.maxLat - q.minLat > 1.5 || q.maxLon - q.minLon > 2.5) throw new HttpError(400, "too_large", "Zoom in to see public transport vehicles");
  const [a, b, c, d] = [snap(q.minLat), snap(q.minLon), snap(q.maxLat), snap(q.maxLon)];
  const zoom = Math.round(q.zoom);
  const segments = vehicleFeed("transitous", `transit:trips:${a},${b},${c},${d},${zoom}`, 10_000, async (): Promise<TripSegment[]> => {
    const now = transitClock.now();
    const url = `${BASE}/map/trips?min=${a},${b}&max=${c},${d}&zoom=${zoom}&startTime=${new Date(now - 300_000).toISOString()}&endTime=${new Date(now + 300_000).toISOString()}`;
    const data = await fetchJson("Transitous", url, z.array(Segment), { timeoutMs: 15_000 });
    return data.filter(s => s.mode !== "AIRPLANE").map(s => ({
      tripId: s.trips[0]?.tripId ?? `${s.from.name}-${s.departure}`,
      tripIds: s.trips.map(t => t.tripId),
      route: s.trips[0]?.routeShortName ?? "",
      mode: s.mode, from: ref(s.from), to: ref(s.to),
      departure: Date.parse(s.departure), arrival: Date.parse(s.arrival),
      delayMin: s.realTime ? Math.round((Date.parse(s.arrival) - Date.parse(s.scheduledArrival)) / 60_000) : null,
      realTime: s.realTime, line: decodePolyline(s.polyline), occupancy: null, fix: null,
    }));
  }, 120_000);
  const padded = { minLat: Math.max(-90, q.minLat - 0.02), maxLat: Math.min(90, q.maxLat + 0.02), minLon: Math.max(-180, q.minLon - 0.03), maxLon: Math.min(180, q.maxLon + 0.03) };
  const rome = inRome(q);
  const [planned, national, atac] = await Promise.allSettled([segments, nationalReports(padded), rome ? romeVehicles() : Promise.resolve([])]);
  const reports = [...(national.status === "fulfilled" ? national.value : []), ...(atac.status === "fulfilled" ? romeReports(atac.value) : [])];
  const timetable = planned.status === "fulfilled" ? planned.value : [];
  const preliminary = updateVehicles(timetable, reports);
  const context = preliminary.filter(v => v.fix && isTransitousTrip(v.tripId) && !vehicleTracker.hasRoute(v.tripId)).slice(0, 2);
  await Promise.all(context.map(async v => {
    try { vehicleTracker.setRoute(v.tripId, await transitousRoute(v.tripId)); }
    catch (error: unknown) {
      vehicleTracker.setRoute(v.tripId, []);
      log.warn("Transit route context unavailable", { tripId: v.tripId, error: error instanceof Error ? error.message : String(error) });
    }
  }));
  return transitSnapshot(timetable, reports, q, focus ? `vehicle:${focus}` : `${a},${b},${c},${d},${zoom}`, ["transitous", ...nationalSources(padded), ...(rome ? ["atac"] : [])], startedAt, focus);
}

export default defineSource({
  probes: [
    { name: "Public transport · Transitous", url: `${BASE}/map/stops?min=0,0&max=0.01,0.01` },
    { name: "Rome buses · Roma Mobilità", url: ROME_PROBE },
    { name: "Italian trains · ViaggiaTreno", url: VT_PROBE },
    { name: "Belgian trains · iRail", url: IRAIL_PROBE },
    { name: "Belgian rail works · Infrabel", url: INFRABEL_PROBE },
  ],
  routes: {
    "GET /trips": async (req) => json(await buildMapSnapshot(parseQuery(req, bbox.extend({ zoom: z.coerce.number().min(0).max(22) })))),
    "GET /vehicle": async (req) => {
      const hint = parseQuery(req, z.object({ id: z.string().min(1).max(200), lat: lat.optional(), lon: lon.optional() }));
      const { id } = hint;
      const vehicle = vehicleTracker.get(id);
      const point = vehicle?.fix ?? (hint.lat !== undefined && hint.lon !== undefined ? { lat: hint.lat, lon: hint.lon } : null);
      if (!point) throw new HttpError(404, "position_unavailable", "Position unavailable. Waiting for a vehicle report.");
      const result = await buildMapSnapshot({ minLat: Math.max(-90, point.lat - 0.02), maxLat: Math.min(90, point.lat + 0.02), minLon: Math.max(-180, point.lon - 0.03), maxLon: Math.min(180, point.lon + 0.03), zoom: 16 }, id);
      if (!result.vehicles.some(v => v.vehicleId === id)) throw new HttpError(404, "position_unavailable", "Position unavailable. Waiting for a vehicle report.");
      return json(result);
    },

    "GET /occupancy": async (req) => {
      const q = parseQuery(req, z.object({ tripId: z.string().min(1).max(200), vehicleId: z.string().max(200).optional() }));
      const id = atacTripId(q.tripId) ?? q.tripId;
      const v = (await romeVehicles()).find(v => v.tripId === id && (!q.vehicleId || v.label === q.vehicleId));
      return json({ occupancy: v?.occupancy ?? null, at: v?.timestamp ? v.timestamp * 1000 : null, source: ROME_SOURCE });
    },

    "GET /stops": async (req) => {
      const q = parseQuery(req, bbox);
      if (q.maxLat - q.minLat > 0.2 || q.maxLon - q.minLon > 0.3) throw new HttpError(400, "too_large", "Zoom in to see stops");
      const [a, b, c, d] = [snap(q.minLat), snap(q.minLon), snap(q.maxLat), snap(q.maxLon)];
      const stops = await memo(`transit:stops:${a},${b},${c},${d}`, 3_600_000, async (): Promise<TransitStop[]> => {
        const data = await fetchJson("Transitous", `${BASE}/map/stops?min=${a - 0.005},${b - 0.005}&max=${c + 0.005},${d + 0.005}`, z.array(Place));
        return data.map((p) => ({ ...ref(p), modes: p.modes ?? [] }));
      });
      return json(stops, { maxAge: 3600 });
    },

    "GET /departures": async (req) => {
      const q = parseQuery(req, z.object({ stopId: z.string().min(1).max(200) }));
      return json(await memo(`transit:board:${q.stopId}`, 20_000, () => buildBoard(q.stopId)));
    },

    "GET /train": async (req) => {
      const q = parseQuery(req, TrainQuery);
      if (q.country === "BE") return json(await irailTrain(q.id));
      const run = await vtResolve({ country: "IT", number: q.number, label: String(q.number), origin: q.origin ?? null, dateMs: q.date ?? null });
      return json(await vtTrain(run.origin, q.number, run.dateMs));
    },

    "GET /trip": async (req) => {
      const q = parseQuery(req, z.object({ tripId: z.string().min(1).max(300).refine(isTransitousTrip, "Not a Transitous trip id") }));
      return json(await transitousTrip(q.tripId));
    },

    "GET /train/find": async (req) => {
      const q = parseQuery(req, z.object({ q: z.string().trim().min(1).max(20) }));
      const number = Number(/(\d{1,5})\s*$/.exec(q.q)?.[1]);
      if (!Number.isInteger(number) || number < 1) throw new HttpError(400, "bad_query", "Type a train number, for example 4694 or IC 1832");

      const italian = async (): Promise<TrainDetail | null> => {
        if ((await vtFindRuns(number)).length === 0) return null;
        const run = await vtResolve({ country: "IT", number, label: String(number), origin: null, dateMs: null });
        return vtTrain(run.origin, number, run.dateMs);
      };
      const vehicleId = iRailVehicleId(q.q);
      const belgian = async (): Promise<TrainDetail | null> => {
        if (!vehicleId) return null;
        try {
          return await irailTrain(vehicleId);
        } catch (err) {
          // iRail answers an unknown vehicle with an HTTP error; that means "no such train", not "iRail is down".
          if (err instanceof HttpError && (err.code === "upstream_status" || err.code === "train_unknown")) return null;
          throw err;
        }
      };
      const [it, be] = await Promise.all([italian(), belgian()]);
      // "IC 3122" names a type. iRail answers by number alone, and an Italian regional train can share the number,
      // so a match counts only when its own label agrees with what was typed.
      const typed = q.q.replace(/\s+/g, "").toUpperCase();
      const typedType = /^[A-Za-z]+/.exec(q.q)?.[0]?.toUpperCase();
      const belgianMatch = be && be.label.replace(/\s+/g, "").toUpperCase() === typed ? be : null;
      const italianMatch = it && (!typedType || it.label.trim().split(/\s+/)[0]?.toUpperCase() === typedType) ? it : null;
      const matches: TrainMatch[] = [belgianMatch, italianMatch].flatMap((t) => (t ? [{ ref: t.ref, label: t.label, route: `${t.origin} to ${t.destination}` }] : []));
      return json(matches);
    },

    "GET /alerts": async (req) => {
      const q = parseQuery(req, z.object({ lat, lon }));
      const [operators, belgium] = await Promise.allSettled([transitousAreaAlerts(q.lat, q.lon), irailNear(q.lat, q.lon)]);
      const settled = (r: PromiseSettledResult<TransitAlert[]>, source: string): TransitAlert[] => {
        if (r.status === "fulfilled") return r.value;
        log.warn("Area alerts failed", { source, error: r.reason instanceof Error ? r.reason.message : String(r.reason) });
        return [];
      };
      if (operators.status === "rejected" && belgium.status === "rejected") throw operators.reason;
      return json(mergeAlerts(settled(operators, "Transitous"), settled(belgium, "iRail")));
    },

    // Infrabel's plan changes once a day; the rows are cached and the "started" flags are worked out per request.
    "GET /rail/works": async () => {
      return json(await currentWorks(), { maxAge: 600 });
    },

    "GET /rail/crossings": async () => json(await fetchCrossings(), { maxAge: 86_400 }),

    "GET /rail/near": async (req) => {
      const q = parseQuery(req, z.object({ lat, lon, radius: z.coerce.number().int().min(100).max(5000).default(1500) }));
      // Infrabel runs the Belgian network only: anywhere else has nothing to say, and costs no request.
      if (!isNearBelgium(q.lat, q.lon)) return json([]);
      const { works } = await currentWorks();
      return json(worksNear(works, q, q.radius), { maxAge: 600 });
    },
  },
});
