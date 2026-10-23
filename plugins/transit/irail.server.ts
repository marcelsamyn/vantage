import { HttpError, diskMemo, fetchJson, memo, webUrl, z } from "../../server/kit";
import { distanceM } from "../../shared/geo";
import { byImportance } from "./alerts.server";
import { IDENTITY } from "./http.server";
import type { Departure, TrainDetail, TrainOccupancy, TripStop, TransitAlert } from "./types";

/**
 * iRail: an open API over the Belgian railways (SNCB/NMBS) data. It asks every client to send an identifying
 * User-Agent and to keep its request rate fair, so everything here is cached.
 */
export const IRAIL_SOURCE = "iRail (SNCB/NMBS data)";
const BASE = "https://api.irail.be";
export const IRAIL_PROBE = `${BASE}/disturbances/?format=json`;
const HEADERS = { "user-agent": IDENTITY };
const q = "format=json&lang=en";

const str = z.string();
const secs = z.coerce.number();
const flag = z.string().transform((v) => v === "1");

const Occupancy = z.object({ name: z.string() }).optional();
const occupancyOf = (o: z.infer<typeof Occupancy>): TrainOccupancy | null => (o?.name === "low" || o?.name === "medium" || o?.name === "high" ? o.name : null);

const Liveboard = z.object({
  stationinfo: z.object({ name: str, locationX: z.coerce.number(), locationY: z.coerce.number() }),
  departures: z.object({
    departure: z
      .array(
        z.object({
          station: str,
          time: secs,
          delay: secs,
          canceled: flag,
          vehicle: str,
          vehicleinfo: z.object({ shortname: str }),
          platform: str,
          platforminfo: z.object({ normal: flag }),
          occupancy: Occupancy,
        }),
      )
      .default([]),
  }),
});

const Vehicle = z.object({
  vehicleinfo: z.object({ shortname: str }),
  stops: z.object({
    stop: z.array(
      z.object({
        station: str,
        platform: str,
        platforminfo: z.object({ normal: flag }),
        scheduledDepartureTime: secs,
        scheduledArrivalTime: secs,
        departureDelay: secs,
        arrivalDelay: secs,
        departureCanceled: flag,
        arrivalCanceled: flag,
        left: flag,
        arrived: flag,
        occupancy: Occupancy,
      }),
    ),
  }),
});

const Disturbances = z.object({
  disturbance: z
    .array(z.object({ id: z.string(), title: str, description: str, link: z.string().optional(), timestamp: secs, type: z.string().optional() }))
    .default([]),
});

const Stations = z.object({ station: z.array(z.object({ id: str, name: str, standardname: str, locationX: z.coerce.number(), locationY: z.coerce.number() })) });

/** iRail station id for a Transitous SNCB stop id: "be-sncb_S8813003" is "BE.NMBS.008813003". */
export function iRailStationId(transitousStopId: string): string | null {
  const m = /^be-sncb_S?(\d{7})$/.exec(transitousStopId);
  return m?.[1] ? `BE.NMBS.00${m[1]}` : null;
}

/** "IC 1832", "IC1832" and "s8 6571" all name a vehicle; iRail wants "BE.NMBS.IC1832". */
export function iRailVehicleId(typed: string): string | null {
  const m = /^\s*([A-Za-z]{1,4}\d{0,2})\s*(\d{2,5})\s*$/.exec(typed);
  return m?.[1] && m[2] ? `BE.NMBS.${m[1].toUpperCase()}${m[2]}` : null;
}

const typeOf = (shortname: string): string => shortname.split(" ")[0] ?? shortname;

export function irailDepartures(stationId: string): Promise<{ stop: { name: string; lat: number; lon: number }; departures: Departure[] }> {
  return memo(`transit:irail:board:${stationId}`, 30_000, async () => {
    const data = await fetchJson("iRail", `${BASE}/liveboard/?id=${encodeURIComponent(stationId)}&arrdep=departure&${q}`, Liveboard, { headers: HEADERS });
    const departures = data.departures.departure.map(
      (d): Departure => ({
        tripId: d.vehicle,
        route: typeOf(d.vehicleinfo.shortname),
        headsign: d.station,
        mode: "REGIONAL_RAIL",
        time: (d.time + d.delay) * 1000,
        scheduled: d.time * 1000,
        realTime: true,
        cancelled: d.canceled,
        track: d.platform && d.platform !== "?" ? d.platform : null,
        trackChanged: !d.platforminfo.normal,
        agency: "SNCB",
        routeColor: null,
        routeTextColor: null,
        accessible: null,
        note: null,
        train: { country: "BE", vehicleId: d.vehicle, label: d.vehicleinfo.shortname },
        occupancy: occupancyOf(d.occupancy),
      }),
    );
    return { stop: { name: data.stationinfo.name, lat: data.stationinfo.locationY, lon: data.stationinfo.locationX }, departures };
  });
}

export function irailTrain(vehicleId: string): Promise<TrainDetail> {
  return memo(`transit:irail:train:${vehicleId}`, 30_000, async () => {
    const data = await fetchJson("iRail", `${BASE}/vehicle/?id=${encodeURIComponent(vehicleId)}&${q}`, Vehicle, { headers: HEADERS });
    const raw = data.stops.stop;
    const first = raw[0];
    const last = raw[raw.length - 1];
    if (!first || !last) throw new HttpError(404, "train_unknown", `iRail has no stops for ${vehicleId}`);

    const stops = raw.map((s, i): TripStop => {
      const isFirst = i === 0;
      const isLast = i === raw.length - 1;
      const plannedDeparture = s.scheduledDepartureTime * 1000;
      const plannedArrival = s.scheduledArrivalTime * 1000;
      return {
        name: s.station,
        arrival: isFirst ? null : { planned: plannedArrival, actual: plannedArrival + s.arrivalDelay * 1000 },
        departure: isLast ? null : { planned: plannedDeparture, actual: plannedDeparture + s.departureDelay * 1000 },
        platform: s.platform && s.platform !== "?" ? s.platform : null,
        trackChanged: !s.platforminfo.normal,
        passed: s.left || s.arrived,
        cancelled: isFirst ? s.departureCanceled : isLast ? s.arrivalCanceled : s.arrivalCanceled || s.departureCanceled,
        delayMin: s.left || s.arrived ? Math.round((s.left ? s.departureDelay : s.arrivalDelay) / 60) : null,
      };
    });

    const lastPassed = raw.findLast((s) => s.left || s.arrived);
    const everyStopCancelled = stops.every((s) => s.cancelled);
    const status: TrainDetail["status"] = everyStopCancelled ? "cancelled" : raw[raw.length - 1]?.arrived ? "arrived" : lastPassed ? "running" : "scheduled";
    const seenAt = lastPassed ? (lastPassed.left ? lastPassed.scheduledDepartureTime + lastPassed.departureDelay : lastPassed.scheduledArrivalTime + lastPassed.arrivalDelay) * 1000 : null;
    const next = raw.find((s) => !s.left && !s.arrived);

    return {
      ref: { country: "BE", vehicleId, label: data.vehicleinfo.shortname },
      label: data.vehicleinfo.shortname,
      operator: "SNCB",
      origin: first.station,
      destination: last.station,
      status,
      delayMin: lastPassed ? Math.round((lastPassed.left ? lastPassed.departureDelay : lastPassed.arrivalDelay) / 60) : null,
      lastSeen: lastPassed && seenAt ? { station: lastPassed.station, at: seenAt } : null,
      stops,
      notes: everyStopCancelled ? [] : stops.filter((s) => s.cancelled).map((s) => `Stop cancelled: ${s.name}`),
      occupancy: occupancyOf(next?.occupancy),
      source: IRAIL_SOURCE,
    };
  });
}

const StoredStation = z.object({ names: z.array(z.string()), lat: z.number(), lon: z.number() });

interface BelgianStation {
  names: string[];
  lat: number;
  lon: number;
}

const normalize = (s: string): string =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\bbrux\b\.?/g, "bruxelles")
    .replace(/\bbrus\b\.?/g, "brussel");

/** Place names a station goes by ("Namur", "Namen"): the first word of each language variant. */
function placeNames(standardname: string, name: string): string[] {
  const names = new Set<string>();
  for (const variant of [...standardname.split("/"), name]) {
    const first = normalize(variant).trim().split(/[-\s]/)[0] ?? "";
    if (first.length >= 4) names.add(first);
  }
  return [...names];
}

function belgianStations(): Promise<BelgianStation[]> {
  return diskMemo("transit-irail-stations-be", 7 * 24 * 3_600_000, async () => {
    const data = await fetchJson("iRail", `${BASE}/stations/?${q}`, Stations, { headers: HEADERS, timeoutMs: 20_000 });
    // iRail also lists foreign stations. Belgian UIC codes start with 0088, and only those say where Belgium is.
    return data.station.filter((s) => s.id.startsWith("BE.NMBS.0088")).map((s) => ({ names: placeNames(s.standardname, s.name), lat: s.locationY, lon: s.locationX }));
  }, z.array(StoredStation));
}

function severityOf(title: string, text: string): TransitAlert["severity"] {
  if (/no trains|interrupted|suspended|cancelled/i.test(title)) return "alarm";
  if (/strike|fewer trains|delays|works|replacement/i.test(`${title} ${text}`)) return "sodium";
  return "info";
}

/** Every national disturbance and planned change iRail lists right now. */
export function irailDisturbances(): Promise<TransitAlert[]> {
  return memo("transit:irail:disturbances", 120_000, async () => {
    const data = await fetchJson("iRail", `${BASE}/disturbances/?${q}`, Disturbances, { headers: HEADERS });
    return data.disturbance.map(
      (d): TransitAlert => ({
        id: `sncb:${d.id}:${d.timestamp}`,
        operator: "SNCB",
        title: d.title,
        text: d.description,
        routes: [],
        stops: [],
        severity: severityOf(d.title, d.description),
        from: d.timestamp * 1000,
        until: null,
        link: webUrl(d.link),
      }),
    );
  });
}

const AREA_KM = 30;
const BELGIUM_KM = 20;
/** Belgium with about 50 km to spare. Outside it, iRail cannot have anything to say, so its station list is not loaded. */
const NEAR_BELGIUM = { south: 49.0, north: 52.1, west: 1.8, east: 7.2 };

export const isNearBelgium = (lat: number, lon: number): boolean => lat >= NEAR_BELGIUM.south && lat <= NEAR_BELGIUM.north && lon >= NEAR_BELGIUM.west && lon <= NEAR_BELGIUM.east;

/**
 * Disturbances that touch a place: the ones naming a station within 30 km of it, and the national ones
 * ("Belgium: …") when the place is inside Belgium. Empty outside Belgium.
 */
export async function irailNear(lat: number, lon: number): Promise<TransitAlert[]> {
  if (!isNearBelgium(lat, lon)) return [];
  const stations = await belgianStations();
  const near = stations.filter((s) => distanceM({ lat, lon }, s) <= AREA_KM * 1000);
  if (!stations.some((s) => distanceM({ lat, lon }, s) <= BELGIUM_KM * 1000)) return [];
  const names = new Set(near.flatMap((s) => s.names));
  const all = await irailDisturbances();
  return all
    .filter((a) => {
      const text = normalize(`${a.title} ${a.text.slice(0, 160)}`);
      if (/^(belgium|belgie|belgique)\b/.test(normalize(a.title))) return true;
      return [...names].some((n) => text.includes(n));
    })
    .sort(byImportance);
}
