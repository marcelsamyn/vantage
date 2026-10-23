import { fetchJson, log, z } from "../../server/kit";
import { bmcFetch, bmcTtl } from "./bmc.server";
import { decodeFeed } from "./gtfsrt";
import { IDENTITY, fetchBytes } from "./http.server";
import { BRUSSELS, stibVehicles } from "./stib.server";
import { stampVehicles, transitClock, vehicleFeed } from "./feeds.server";
import type { Occupancy, VehicleReport } from "./types";

/**
 * National measured vehicle feeds joined to Transitous routes:
 * OVapi (Netherlands), Renfe Cercanías (Spain), Entur (Norway), TEC (Wallonia), STIB (Brussels) and Carris
 * Metropolitana (Lisbon region). Arrival-time predictions are kept as route information, not mistaken for GPS.
 */

export interface Bbox {
  minLat: number;
  minLon: number;
  maxLat: number;
  maxLon: number;
}

export interface LiveVehicle {
  /** The operator's trip id, which Transitous trip ids end with; for STIB, which has none, an id of its own. */
  tripId: string;
  vehicleId?: string;
  lat: number;
  lon: number;
  at: number;
  label: string;
  route: string;
  mode: string;
  delayMin: number | null;
  occupancy: Occupancy | null;
  stopId?: string;
  bearing?: number | null;
  speedMs?: number | null;
  evidence?: "gps" | "route-distance";
  serviceDate?: string;
  startTime?: string;
  stopSequence?: number | null;
  stopStatus?: "incoming" | "stopped" | "moving" | null;
  receivedAt?: number;
  producedAt?: number;
}

interface Feed {
  id: string;
  credit: string;
  /** Rough outline of the country, so a request elsewhere costs nothing. */
  area: Bbox;
  load: (box: Bbox) => Promise<LiveVehicle[]>;
  /** Narrower namespace when a country has several live feeds. */
  scope?: string;
}

const inBox = (v: { lat: number; lon: number }, b: Bbox): boolean => v.lat >= b.minLat && v.lat <= b.maxLat && v.lon >= b.minLon && v.lon <= b.maxLon;
const overlaps = (a: Bbox, b: Bbox): boolean => a.minLat <= b.maxLat && a.maxLat >= b.minLat && a.minLon <= b.maxLon && a.maxLon >= b.minLon;

// ── Netherlands: OVapi ────────────────────────────────────────────

/** Vehicle ids look like "2026-10-08:GVB:5:10143": date, operator, line planning number, journey. */
function dutchVehicle(id: string, label: string): { route: string; mode: string; operator: string } {
  const [, operator = "", line = ""] = id.split(":");
  const metro = operator === "RET" && /^M\d/.test(line);
  return { route: /^\d{1,3}[A-Z]?$/.test(line) ? line : "", mode: metro ? "SUBWAY" : "OTHER", operator: operator || label };
}

const ovapi: Feed = {
  id: "nl",
  credit: "OVapi · Dutch national feed",
  area: { minLat: 50.7, minLon: 3.3, maxLat: 53.7, maxLon: 7.3 },
  load: (box) =>
    vehicleFeed("nl", "transit:live:nl", 15_000, async () => {
      const feed = decodeFeed(await fetchBytes("OVapi", "https://gtfs.ovapi.nl/nl/vehiclePositions.pb"));
      return stampVehicles(feed).map((v): LiveVehicle => {
        const d = dutchVehicle(v.id, v.label);
        return { ...v, vehicleId: v.vehicleId || (v.label && v.label !== "0" ? `${v.label}:${d.operator}` : v.tripId), at: v.timestamp, label: v.label && v.label !== "0" ? `${v.label} · ${d.operator}` : d.operator, route: d.route, mode: d.mode, delayMin: null };
      });
    }).then((all) => all.filter((v) => inBox(v, box))),
};

// ── Spain: Renfe Cercanías ────────────────────────────────────────

const renfe: Feed = {
  id: "es",
  credit: "Renfe Cercanías · Spanish national feed",
  area: { minLat: 35.8, minLon: -9.5, maxLat: 43.9, maxLon: 4.5 },
  load: (box) =>
    vehicleFeed("es", "transit:live:es", 15_000, async () => {
      const feed = decodeFeed(await fetchBytes("Renfe", "https://gtfsrt.renfe.com/vehicle_positions.pb"));
      // Labels read "C4-23667": the line, then the train number.
      return stampVehicles(feed).map((v): LiveVehicle => ({ ...v, at: v.timestamp, route: v.label.split("-")[0] ?? "", mode: "REGIONAL_RAIL", delayMin: null }));
    }).then((all) => all.filter((v) => inBox(v, box))),
};

// ── Norway: Entur ─────────────────────────────────────────────────

const ENTUR_MODE: Record<string, string> = { RAIL: "REGIONAL_RAIL", BUS: "BUS", COACH: "COACH", TRAM: "TRAM", METRO: "SUBWAY", WATER: "FERRY", AIR: "AIRPLANE", CABLEWAY: "TRAM", FUNICULAR: "TRAM", LIFT: "TRAM" };
const ENTUR_OCCUPANCY: Record<string, Occupancy | undefined> = {
  empty: "empty",
  manySeatsAvailable: "many_seats",
  fewSeatsAvailable: "few_seats",
  standingRoomOnly: "standing",
  crushedStandingRoomOnly: "crushed",
  full: "full",
  notAcceptingPassengers: "closed",
};

const EnturVehicles = z.object({
  data: z.object({
    vehicles: z.array(
      z.object({
        vehicleId: z.string(),
        lastUpdated: z.iso.datetime({ offset: true }),
        location: z.object({ latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180) }),
        delay: z.number().nullable(),
        mode: z.string().nullable(),
        occupancyStatus: z.string().nullable(),
        line: z.object({ publicCode: z.string().nullable() }).nullable(),
        serviceJourney: z.object({ id: z.string() }).nullable(),
      }),
    ),
  }),
});

const ENTUR_QUERY = `query($b: BoundingBox!) { vehicles(boundingBox: $b) { vehicleId lastUpdated location { latitude longitude } delay mode occupancyStatus line { publicCode } serviceJourney { id } } }`;

const entur: Feed = {
  id: "no",
  credit: "Entur · Norwegian national feed",
  area: { minLat: 57.9, minLon: 4.4, maxLat: 71.3, maxLon: 31.3 },
  load: (box) => {
    // Entur filters by box on its side, so snap the box to keep the cache useful and cap what one call asks for.
    const b = { minLat: Math.floor(box.minLat * 50) / 50, minLon: Math.floor(box.minLon * 50) / 50, maxLat: Math.ceil(box.maxLat * 50) / 50, maxLon: Math.ceil(box.maxLon * 50) / 50 };
    if (b.maxLat - b.minLat > 0.8 || b.maxLon - b.minLon > 1.6) return Promise.resolve([]);
    return vehicleFeed("no", `transit:live:no:${b.minLat},${b.minLon},${b.maxLat},${b.maxLon}`, 15_000, async () => {
      const data = await fetchJson("Entur", "https://api.entur.io/realtime/v2/vehicles/graphql", EnturVehicles, {
        method: "POST",
        headers: { "content-type": "application/json", "ET-Client-Name": "vantage-personal-dashboard", "user-agent": IDENTITY },
        body: JSON.stringify({ query: ENTUR_QUERY, variables: { b } }),
        timeoutMs: 15_000,
      });
      const receivedAt = transitClock.now();
      return data.data.vehicles.flatMap((v): LiveVehicle[] =>
        v.serviceJourney
          ? [
              {
                tripId: v.serviceJourney.id,
                lat: v.location.latitude,
                lon: v.location.longitude,
                at: Math.floor(Date.parse(v.lastUpdated) / 1000),
                label: v.vehicleId,
                vehicleId: v.vehicleId,
                receivedAt,
                route: v.line?.publicCode ?? "",
                mode: ENTUR_MODE[v.mode ?? ""] ?? "OTHER",
                delayMin: v.delay === null ? null : Math.round(v.delay / 60),
                occupancy: ENTUR_OCCUPANCY[v.occupancyStatus ?? ""] ?? null,
              },
            ]
          : [],
      );
    });
  },
};

// ── Belgium: TEC (Wallonia) ───────────────────────────────────────

/**
 * Route ids read "gr:tec:L0033-23467": a zone letter, a four digit code, then a suffix. Only Liège (L) puts the
 * public line number in the code; its 1000 series is the tram, where 1000 is line T1. Elsewhere the code is not
 * a line number.
 */
export function tecLine(routeId: string): { route: string; mode: string } {
  const code = /^gr:tec:L(\d{4})-/.exec(routeId)?.[1];
  if (code === undefined) return { route: "", mode: "BUS" };
  const n = Number(code);
  return n >= 1000 ? { route: `T${n - 999}`, mode: "TRAM" } : { route: String(n), mode: "BUS" };
}

const tec: Feed = {
  id: "be",
  credit: "TEC · Belgian Mobility open data (CC BY 4.0)",
  area: { minLat: 49.45, minLon: 2.8, maxLat: 50.85, maxLon: 6.45 },
  load: (box) =>
    vehicleFeed("be", "transit:live:be", bmcTtl(15_000), async () => {
      const res = await bmcFetch("TEC", "/gtfs/feed/tec/rt/vehicle-position?format=protobuf", "application/x-protobuf, */*");
      const feed = decodeFeed(new Uint8Array(await res.arrayBuffer()));
      return stampVehicles(feed).map((v): LiveVehicle => ({ ...v, tripId: v.tripId, lat: v.lat, lon: v.lon, at: v.timestamp, label: v.label, ...tecLine(v.routeId), delayMin: null, occupancy: v.occupancy, stopId: v.stopId, bearing: v.bearing, speedMs: v.speedMs }));
    }).then((all) => all.filter((v) => inBox(v, box))),
};

// ── Belgium: STIB (Brussels) ──────────────────────────────────────

const stib: Feed = {
  id: "bxl",
  credit: "STIB-MIVB · Belgian Mobility open data (CC BY 4.0)",
  area: BRUSSELS,
  load: (box) => stibVehicles().then((all) => all.filter((v) => inBox(v, box))),
  scope: "be-stib",
};

// ── Portugal: Carris Metropolitana (Lisbon region) ────────────────

const CarrisVehicles = z.array(
  z.object({
    id: z.string(),
    trip_id: z.string().nullable().optional(),
    line_id: z.string().nullable().optional(),
    lat: z.number().min(-90).max(90),
    lon: z.number().min(-180).max(180),
    /** Epoch milliseconds. */
    timestamp: z.number().nonnegative(),
    occupancy_status: z.string().nullable().optional(),
  }),
);

/** GTFS-RT occupancy names, as the Carris Metropolitana API spells them. */
const GTFS_OCCUPANCY: Record<string, Occupancy | undefined> = {
  EMPTY: "empty",
  MANY_SEATS_AVAILABLE: "many_seats",
  FEW_SEATS_AVAILABLE: "few_seats",
  STANDING_ROOM_ONLY: "standing",
  CRUSHED_STANDING_ROOM_ONLY: "crushed",
  FULL: "full",
  NOT_ACCEPTING_PASSENGERS: "closed",
};

/** Carris trip ids need route, path and time matching against the timetable. */
const carris: Feed = {
  id: "pt",
  credit: "Carris Metropolitana · open data",
  area: { minLat: 38.4, minLon: -9.5, maxLat: 39.1, maxLon: -8.6 },
  load: (box) =>
    vehicleFeed("pt", "transit:live:pt", 15_000, async () => {
      const data = await fetchJson("Carris Metropolitana", "https://api.carrismetropolitana.pt/v2/vehicles", CarrisVehicles, { headers: { "user-agent": IDENTITY }, timeoutMs: 15_000 });
      const receivedAt = transitClock.now();
      return data.flatMap((v): LiveVehicle[] =>
        v.trip_id && v.line_id
          ? [{ tripId: v.trip_id, lat: v.lat, lon: v.lon, at: Math.floor(v.timestamp / 1000), label: v.id, vehicleId: v.id, receivedAt, route: v.line_id, mode: "BUS", delayMin: null, occupancy: GTFS_OCCUPANCY[v.occupancy_status ?? ""] ?? null }]
          : [],
      );
    }).then((all) => all.filter((v) => inBox(v, box))),
  scope: "pt-Carris-Metropolitana",
};

const FEEDS: Feed[] = [ovapi, renfe, entur, tec, stib, carris];

export function nationalSources(box: Bbox): string[] { return FEEDS.filter(feed => overlaps(feed.area, box)).map(feed => feed.id); }

/**
 * Put national GPS positions into a list of Transitous segments for one map box.
 * Adjacent timetable legs are grouped even outside the countries above.
 */
export async function nationalReports(box: Bbox): Promise<VehicleReport[]> {
  const feeds = FEEDS.filter((f) => overlaps(f.area, box));
  if (feeds.length === 0) return [];

  const loaded = await Promise.all(
    feeds.map(async (f) => {
      try {
        return { feed: f, vehicles: await f.load(box) };
      } catch (err) {
        // A national feed that is down must not hide the vehicles Transitous knows; the layer keeps working without it.
        log.warn("national vehicle feed failed", { feed: f.id, error: err instanceof Error ? err.message : String(err) });
        return { feed: f, vehicles: [] as LiveVehicle[] };
      }
    }),
  );

  const reports = loaded.flatMap(({ feed, vehicles }) => vehicles.map((v): VehicleReport => ({
    scope: feed.scope ?? feed.id, source: feed.id, id: v.evidence === "route-distance" ? v.tripId : v.vehicleId || v.label || v.tripId, identity: v.evidence === "route-distance" ? "anonymous" : v.vehicleId ? "vehicle" : "trip",
    tripId: v.tripId, route: v.route, mode: v.mode, stopId: v.stopId ?? "", delayMin: v.delayMin, occupancy: v.occupancy,
    fix: { lon: v.lon, lat: v.lat, at: v.at * 1000, receivedAt: v.receivedAt, producedAt: v.producedAt, feed: feed.credit, label: v.label, tripId: v.tripId, bearing: v.bearing, speedMs: v.speedMs, evidence: v.evidence ?? "gps", serviceDate: v.serviceDate, startTime: v.startTime, stopSequence: v.stopSequence, stopStatus: v.stopStatus },
  })));
  return reports;
}
