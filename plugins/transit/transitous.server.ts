import { decodePolyline } from "./geometry";
import type { VehicleLeg } from "./types";
import { fetchJson, memo, webUrl, z } from "../../server/kit";
import { byImportance } from "./alerts.server";
import type { Departure, StopRef, TransitAlert, TripDetail, TripStop } from "./types";

/**
 * Transitous: a community-run MOTIS instance over the open GTFS and GTFS-RT feeds of operators worldwide.
 * Its live delays, cancellations and service alerts come from each operator's own GTFS-RT feed.
 */
export const BASE = "https://api.transitous.org/api/v1";
export const TRANSITOUS_SOURCE = "Transitous (open GTFS data from operators)";
/** Operators translate alerts into English often enough to ask for it; Transitous falls back to the original. */
const LANGUAGE = "en";

const Period = z.object({ start: z.string().optional(), end: z.string().optional() });

const Alert = z.object({
  headerText: z.string(),
  descriptionText: z.string(),
  url: z.string().optional(),
  cause: z.string().optional(),
  effect: z.string().optional(),
  severityLevel: z.string().optional(),
  impactPeriod: z.array(Period).optional(),
  communicationPeriod: z.array(Period).optional(),
});

export const Place = z.object({
  name: z.string(),
  stopId: z.string().optional(),
  lat: z.number(),
  lon: z.number(),
  track: z.string().optional(),
  scheduledTrack: z.string().optional(),
  cancelled: z.boolean().optional(),
  modes: z.array(z.string()).optional(),
  alerts: z.array(Alert).optional(),
});

const StopTime = z.object({
  place: Place.extend({ departure: z.string().optional(), scheduledDeparture: z.string().optional() }),
  mode: z.string(),
  realTime: z.boolean(),
  headsign: z.string().default(""),
  tripId: z.string(),
  routeShortName: z.string().optional(),
  displayName: z.string().optional(),
  agencyName: z.string().default(""),
  routeColor: z.string().optional(),
  routeTextColor: z.string().optional(),
  tripCancelled: z.boolean().optional(),
  wheelchairAccessible: z.string().optional(),
});

const StopTimes = z.object({ stopTimes: z.array(StopTime), place: Place.optional() });

export const ref = (p: z.infer<typeof Place>): StopRef => ({ stopId: p.stopId ?? p.name, name: p.name, lat: p.lat, lon: p.lon });

/** The line name riders know. Trenitalia route names carry the agency code first: "0083_FR" is a Frecciarossa. */
function routeName(st: z.infer<typeof StopTime>): string {
  const name = st.displayName ?? st.routeShortName ?? "";
  return st.tripId.includes("it-trenitalia_") ? name.replace(/^\d{4}_/, "") : name;
}

function severityOf(a: z.infer<typeof Alert>): TransitAlert["severity"] {
  if (a.effect === "NO_SERVICE" || a.cause === "STRIKE" || a.severityLevel === "SEVERE") return "alarm";
  if (a.effect === "NO_EFFECT" || a.effect === "ADDITIONAL_SERVICE" || a.severityLevel === "INFO") return "info";
  return "sodium";
}

/** Plain text: no carriage returns, no runs of spaces, no trailing publisher handle such as "(@romamobilita)". */
const clean = (s: string): string =>
  s
    .replace(/\r/g, "")
    .replace(/\(@\w+\)/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

/** Epoch ms, or null for a missing or unreadable time. */
function ms(iso: string | undefined): number | null {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? t : null;
}

/** A departure or a trip, with the alerts Transitous attached to it. */
interface AlertedRun {
  alerts: readonly z.infer<typeof Alert>[] | undefined;
  route: string;
  operator: string;
}

const alertedStopTime = (st: z.infer<typeof StopTime>): AlertedRun => ({ alerts: st.place.alerts, route: routeName(st), operator: st.agencyName });

/**
 * The alerts attached to a list of runs, once each. Transitous repeats an alert on every run it touches; the lines
 * of those runs become the alert's routes. Alerts whose every period has ended are left out.
 */
export function alertsOf(runs: readonly AlertedRun[], now = Date.now()): TransitAlert[] {
  const byKey = new Map<string, TransitAlert>();
  for (const run of runs) {
    for (const a of run.alerts ?? []) {
      const periods = a.impactPeriod?.length ? a.impactPeriod : (a.communicationPeriod ?? []);
      const ends = periods.map((p) => ms(p.end));
      if (ends.length > 0 && ends.every((e) => e !== null && e < now)) continue;
      const title = clean(a.headerText);
      const text = clean(a.descriptionText);
      const key = `${title}\n${text}`;
      const { route } = run;
      const known = byKey.get(key);
      if (known) {
        if (route && !known.routes.includes(route)) known.routes.push(route);
        continue;
      }
      const starts = periods.map((p) => ms(p.start)).filter((t): t is number => t !== null);
      byKey.set(key, {
        id: `transitous:${Bun.hash(key).toString(36)}`,
        operator: run.operator,
        title: title || "Service change",
        text,
        routes: route ? [route] : [],
        stops: [],
        severity: severityOf(a),
        from: starts.length > 0 ? Math.min(...starts) : null,
        until: ends.length > 0 && ends.every((e) => e !== null) ? Math.max(...ends.filter((e): e is number => e !== null)) : null,
        link: webUrl(a.url),
      });
    }
  }
  return [...byKey.values()].sort(byImportance);
}

const accessibility: Record<string, boolean | undefined> = { ACCESSIBLE: true, NOT_ACCESSIBLE: false };

export function departureOf(st: z.infer<typeof StopTime>): Departure {
  const time = Date.parse(st.place.departure ?? "");
  return {
    tripId: st.tripId,
    route: routeName(st),
    headsign: st.headsign,
    mode: st.mode,
    time,
    scheduled: Date.parse(st.place.scheduledDeparture ?? st.place.departure ?? ""),
    realTime: st.realTime,
    cancelled: Boolean(st.place.cancelled || st.tripCancelled),
    track: st.place.track ?? st.place.scheduledTrack ?? null,
    trackChanged: Boolean(st.place.track && st.place.scheduledTrack && st.place.track !== st.place.scheduledTrack),
    agency: st.agencyName,
    routeColor: st.routeColor ?? null,
    routeTextColor: st.routeTextColor ?? null,
    accessible: accessibility[st.wheelchairAccessible ?? ""] ?? null,
    note: null,
    // Timetable rows have no train profile: ViaggiaTreno only knows the runs of today.
    train: null,
    occupancy: null,
  };
}

/**
 * The next departures at one stop, with the service alerts on them. Transitous answers for the whole station, so
 * `stopIds` lists the platforms the departures leave from.
 */
export async function transitousBoard(stopId: string): Promise<{ stop: StopRef; departures: Departure[]; alerts: TransitAlert[]; stopIds: string[] }> {
  const data = await fetchJson("Transitous", `${BASE}/stoptimes?stopId=${encodeURIComponent(stopId)}&n=14&withAlerts=true&language=${LANGUAGE}`, StopTimes);
  const first = data.stopTimes[0]?.place ?? data.place;
  return {
    stop: first ? ref(first) : { stopId, name: stopId, lat: 0, lon: 0 },
    departures: data.stopTimes.map(departureOf),
    alerts: alertsOf(data.stopTimes.map(alertedStopTime)),
    stopIds: [stopId, ...data.stopTimes.flatMap((st) => (st.place.stopId ? [st.place.stopId] : []))],
  };
}

const AREA_M = 800;

/** Service alerts on the departures from every stop within 800 m of a place, from any operator Transitous carries. */
export function transitousAreaAlerts(lat: number, lon: number): Promise<TransitAlert[]> {
  const [la, lo] = [lat.toFixed(3), lon.toFixed(3)];
  return memo(`transit:area-alerts:${la},${lo}`, 120_000, async () => {
    const data = await fetchJson("Transitous", `${BASE}/stoptimes?center=${la},${lo}&radius=${AREA_M}&n=60&withAlerts=true&language=${LANGUAGE}`, StopTimes);
    return alertsOf(data.stopTimes.map(alertedStopTime));
  });
}

const Call = Place.extend({ arrival: z.string().optional(), departure: z.string().optional(), scheduledArrival: z.string().optional(), scheduledDeparture: z.string().optional() });

const Leg = z.object({
  legGeometry: z.object({ points: z.string(), precision: z.number().int().min(0).max(7) }).optional(),
  mode: z.string(),
  tripId: z.string().optional(),
  displayName: z.string().optional(),
  routeShortName: z.string().optional(),
  agencyName: z.string().default(""),
  realTime: z.boolean(),
  cancelled: z.boolean().optional(),
  routeColor: z.string().optional(),
  routeTextColor: z.string().optional(),
  from: Call,
  to: Call,
  intermediateStops: z.array(Call).default([]),
  alerts: z.array(Alert).optional(),
});

export const Trip = z.object({ legs: z.array(Leg).min(1) });

const time = (actual: string | undefined, planned: string | undefined): { planned: number | null; actual: number | null } | null =>
  actual || planned ? { planned: ms(planned ?? actual), actual: ms(actual ?? planned) } : null;

function callOf(c: z.infer<typeof Call>, realTime: boolean, now: number): TripStop {
  const arrival = time(c.arrival, c.scheduledArrival);
  const departure = time(c.departure, c.scheduledDeparture);
  const main = departure ?? arrival;
  return {
    name: c.name,
    arrival,
    departure,
    platform: c.track ?? c.scheduledTrack ?? null,
    trackChanged: Boolean(c.track && c.scheduledTrack && c.track !== c.scheduledTrack),
    passed: main?.actual != null && main.actual < now,
    cancelled: c.cancelled ?? false,
    delayMin: realTime && main?.actual != null && main.planned != null ? Math.round((main.actual - main.planned) / 60_000) : null,
  };
}

/** A Transitous trip as a list of calls, with where the vehicle is in it now. */
export function tripDetail(tripId: string, data: z.infer<typeof Trip>, now = Date.now()): TripDetail {
  const [leg] = data.legs;
  if (!leg) throw new Error("a trip has at least one leg");
  const stops = [leg.from, ...leg.intermediateStops, leg.to].map((c) => callOf(c, leg.realTime, now));
  const next = stops.find((s) => !s.passed && !s.cancelled);
  const first = stops[0]?.departure?.actual ?? null;
  const status: TripDetail["status"] = leg.cancelled ? "cancelled" : !next ? "arrived" : first !== null && now < first ? "scheduled" : "running";
  const label = leg.displayName ?? leg.routeShortName ?? "";
  return {
    tripId,
    label,
    mode: leg.mode,
    operator: leg.agencyName,
    origin: leg.from.name,
    // The last stop, not the headsign: operators that chain a vehicle's runs give the headsign of one run only.
    destination: leg.to.name,
    status,
    delayMin: next?.delayMin ?? null,
    realTime: leg.realTime,
    routeColor: leg.routeColor ?? null,
    routeTextColor: leg.routeTextColor ?? null,
    stops,
    alerts: alertsOf([{ alerts: leg.alerts, route: label, operator: leg.agencyName }], now),
    source: TRANSITOUS_SOURCE,
  };
}

/** Every call of one run, with live times where the operator publishes them. */
function tripData(tripId: string): Promise<z.infer<typeof Trip>> {
  return memo(`transit:trip:${tripId}`, 20_000, () => fetchJson("Transitous", `${BASE}/trip?tripId=${encodeURIComponent(tripId)}&withAlerts=true&language=${LANGUAGE}`, Trip));
}

export async function transitousTrip(tripId: string): Promise<TripDetail> {
  return tripDetail(tripId, await tripData(tripId));
}

/** Shape context is independent of the current map box and uses the endpoint's own precision. */
export function transitousRoute(tripId: string): Promise<VehicleLeg[]> {
  return memo(`transit:route:${tripId}`, 3_600_000, async () => {
    const data = await tripData(tripId);
    return data.legs.flatMap(leg => {
      if (leg.cancelled || !leg.legGeometry?.points) return [];
      const calls = [leg.from, ...leg.intermediateStops, leg.to].map(call => ({ stop: ref(call), arrival: ms(call.arrival ?? call.departure) ?? 0, departure: ms(call.departure ?? call.arrival) ?? 0 }));
      return [{ from: ref(leg.from), to: ref(leg.to), departure: calls[0]?.departure ?? 0, arrival: calls.at(-1)?.arrival ?? 0, line: decodePolyline(leg.legGeometry.points, leg.legGeometry.precision), calls }];
    });
  });
}
