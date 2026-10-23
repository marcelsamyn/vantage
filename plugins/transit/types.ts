/**
 * Payloads served by /api/transit.
 * Vehicles, departures and service alerts come from Transitous (community-run, worldwide public transport on open
 * GTFS data). Rome positions and crowding come from Roma Mobilità, Italian trains from Trenitalia ViaggiaTreno, Belgian trains
 * from iRail, Brussels STIB predictions and vehicles from its own live API, and live GPS positions in the
 * Netherlands, Spain, Norway, Wallonia and the Lisbon region from their own feeds.
 */

export interface StopRef {
  stopId: string;
  name: string;
  lat: number;
  lon: number;
}

/** How full a vehicle is, as its operator reports it (GTFS-RT occupancy). */
export type Occupancy = "empty" | "many_seats" | "few_seats" | "standing" | "crushed" | "full" | "closed";

/** A position fix reported by the vehicle itself, from a national live feed. */
export interface VehicleFix {
  lon: number;
  lat: number;
  /** Epoch milliseconds of the fix. */
  at: number;
  /** Credit line for the feed, e.g. "OVapi · Dutch national feed". */
  feed: string;
  /** Fleet number or train label as the feed publishes it. */
  label: string;
  /** Raw operator trip id, retained when its timetable uses another id. */
  tripId?: string;
  bearing?: number | null;
  speedMs?: number | null;
  evidence?: "gps" | "route-distance";
  /** Bound on measurement time error; receipt time is never a measurement. */
  timeErrorMs?: number;
  receivedAt?: number;
  producedAt?: number;
  stopSequence?: number | null;
  stopStatus?: "incoming" | "stopped" | "moving" | null;
  serviceDate?: string;
  startTime?: string;
}

export interface VehicleLeg {
  from: StopRef | null;
  to: StopRef | null;
  departure: number;
  arrival: number;
  line: [number, number][];
  calls?: { stop: StopRef; arrival: number; departure: number }[];
}

export interface VehicleReport {
  /** Feed namespace, such as it-Lazio-Rome or nl. */
  scope: string;
  source: string;
  /** Physical vehicle id within the source; use the trip id only when no vehicle id is published. */
  id: string;
  tripId: string;
  route: string;
  mode: string;
  stopId: string;
  delayMin: number | null;
  occupancy: Occupancy | null;
  fix: VehicleFix;
  identity?: "vehicle" | "trip" | "anonymous";
}

/** One vehicle travelling between two consecutive stops. Times are epoch milliseconds. */
export interface TripSegment {
  tripId: string;
  route: string;
  mode: string;
  /** Null for a vehicle that only a national GPS feed knows: it publishes no stops. */
  from: StopRef | null;
  to: StopRef | null;
  departure: number;
  arrival: number;
  /** Minutes late at the next stop (negative is early); null without real-time data. */
  delayMin: number | null;
  realTime: boolean;
  /** [lon, lat] path between the two stops. */
  line: [number, number][];
  occupancy: Occupancy | null;
  fix: VehicleFix | null;
  /** Stable physical identity when a source publishes one. */
  vehicleId?: string;
  /** All identifiers Transitous publishes for a shared run. */
  tripIds?: string[];
  /** Joined route legs, ordered in time. */
  legs?: VehicleLeg[];
  tracking?: VehicleTracking;
}

export interface RoutePath {
  id: string;
  points: [number, number][];
  meters: number[];
  sections: { start: number; end: number }[];
  stops: { s: number; sequence: number; stopId: string; departure: number; arrival: number }[];
}

export interface MotionState {
  s: number;
  v: number;
  p00: number;
  p01: number;
  p11: number;
  weight: number;
  section: number;
  stopped: boolean;
}

export interface VehicleTracking {
  revision: number;
  at: number;
  pathId: string | null;
  /** Hydrated from the snapshot's shared paths by the client. */
  path?: RoutePath;
  states: MotionState[];
  maxSpeed: number;
  noise: number;
  lateralM: number;
  relocalized: boolean;
  precise: boolean;
}

export interface TransitSourceHealth {
  source: string;
  attemptedAt: number;
  receivedAt: number | null;
  error: string | null;
}

export interface TransitSnapshot {
  epoch: string;
  revision: number;
  serverTime: number;
  durationMs: number;
  clockErrorMs: number;
  queryKey: string;
  sources: TransitSourceHealth[];
  paths: Record<string, RoutePath>;
  vehicles: TripSegment[];
}

export interface TransitStop extends StopRef {
  modes: string[];
}

/** Which Italian or Belgian train a departure row, a search or a profile points at. */
export type TrainRef =
  | {
      country: "IT";
      /** Train number as printed on tickets, e.g. 4694. */
      number: number;
      /** Category and number, e.g. "REG 4694". */
      label: string;
      /** ViaggiaTreno code of the station where the run started, e.g. "S08409"; null until looked up. */
      origin: string | null;
      /** Midnight of the run's service day, epoch ms; null until looked up. */
      dateMs: number | null;
    }
  | {
      country: "BE";
      /** iRail vehicle id, e.g. "BE.NMBS.IC1832". */
      vehicleId: string;
      label: string;
    };

export type TrainOccupancy = "low" | "medium" | "high";

export interface Departure {
  tripId: string;
  route: string;
  headsign: string;
  mode: string;
  time: number;
  /** The timetable time; null for a live prediction with no timetable time beside it. */
  scheduled: number | null;
  realTime: boolean;
  cancelled: boolean;
  track: string | null;
  /** True when the platform differs from the planned one. */
  trackChanged: boolean;
  agency: string;
  /** Official line colours as hex without "#", when the operator publishes them. */
  routeColor: string | null;
  routeTextColor: string | null;
  /** Whether a wheelchair user can board, as the operator says; null when it does not say. */
  accessible: boolean | null;
  /** The operator's remark on this one run, such as "Do not embark". */
  note: string | null;
  /** Set for Italian and Belgian trains: opens the train profile. */
  train: TrainRef | null;
  occupancy: TrainOccupancy | null;
}

export interface TransitAlert {
  id: string;
  /** Who published it: the agency, such as "De Lijn" or "Atac", or "SNCB" for iRail's rail notices. */
  operator: string;
  title: string;
  text: string;
  /** Route short names the alert applies to. */
  routes: string[];
  /** Stop ids (the operator's own, not Transitous ids). */
  stops: string[];
  /** "alarm" when service stops or a strike or demonstration is on; "sodium" for detours and works; "info" otherwise. */
  severity: "alarm" | "sodium" | "info";
  /** Epoch ms; null when open-ended. */
  from: number | null;
  until: number | null;
  link: string | null;
}

export interface Board {
  stop: StopRef;
  departures: Departure[];
  /** Credit line for the live data behind the departures. */
  source: string;
  alerts: TransitAlert[];
  /** Set when a live rail feed failed and the board shows timetable data instead. */
  notice: string | null;
}

/** One call of a train, bus, tram or metro run at a stop. */
export interface TripStop {
  name: string;
  /** Planned and actual arrival; null at the first stop. */
  arrival: { planned: number | null; actual: number | null } | null;
  departure: { planned: number | null; actual: number | null } | null;
  platform: string | null;
  trackChanged: boolean;
  /** The vehicle has already called here. */
  passed: boolean;
  cancelled: boolean;
  /** Minutes late at this stop; null when not known. */
  delayMin: number | null;
}

export interface TrainDetail {
  ref: TrainRef;
  /** "REG 4694", "IC 1832". */
  label: string;
  operator: string;
  origin: string;
  destination: string;
  status: "scheduled" | "running" | "arrived" | "cancelled";
  /** Minutes late right now; null when the feed has no measurement yet. */
  delayMin: number | null;
  /** Last place the train was detected, with the time of detection. */
  lastSeen: { station: string; at: number } | null;
  stops: TripStop[];
  /** Plain-text notes from the operator (diversions, cancelled stops). */
  notes: string[];
  occupancy: TrainOccupancy | null;
  source: string;
}

/** A run that Transitous knows, as a departure row or a vehicle on the map points at it. */
export interface TripRef {
  /** Transitous trip id: "20261011_10:10_be-delijn_…". */
  tripId: string;
  /** Line and destination, for the profile header while the trip loads: "10 to Mariakerke Post". */
  label: string;
}

/** A bus, tram, metro, ferry or train run from Transitous, with every stop it calls at. */
export interface TripDetail {
  tripId: string;
  /** The line as riders know it: "10", "T1", "IC 1530". */
  label: string;
  mode: string;
  operator: string;
  origin: string;
  destination: string;
  status: TrainDetail["status"];
  /** Minutes late at the next stop; null without real-time data. */
  delayMin: number | null;
  realTime: boolean;
  routeColor: string | null;
  routeTextColor: string | null;
  stops: TripStop[];
  alerts: TransitAlert[];
  source: string;
}

export interface TrainMatch {
  ref: TrainRef;
  label: string;
  /** "Roma Termini → Fiumicino Aeroporto" */
  route: string;
}

// ── Belgian rail works and level crossings (Infrabel open data, CC0) ──

/** One planned restriction on one line, as Infrabel files it: a stretch of track with dates and a time of day. */
export interface RailWork {
  /** Infrabel's work number and line: unique for one row. */
  id: string;
  /** Infrabel's line number, e.g. "36" or "130C". */
  line: string;
  /** "A+B", "A", "B": which tracks are affected. */
  tracks: string;
  /** ISO dates, first and last day. */
  first: string;
  last: string;
  /** Local time of day when it starts and ends; for a "Continuous" restriction these only mark the daily handover. */
  timeFrom: string;
  timeTo: string;
  /** "Continuous", "Night", "Day"... as Infrabel words it. */
  continuity: string;
  impact: "Major" | "Minor";
  /** Infrabel's description: "Total Line Closure", "Temporary Speed Restriction"... */
  effect: string;
  /** Names of the stations at either end, in Dutch as Infrabel publishes them. */
  start: string | null;
  end: string | null;
  /** The affected stretch of track, [lon, lat] points. */
  shape: [number, number][][];
  /** True when today falls between the first and the last day. */
  started: boolean;
}

export interface RailWorks {
  /** How many days ahead the list reaches. */
  horizonDays: number;
  works: RailWork[];
}

export interface LevelCrossing {
  /** Infrabel's code, e.g. "L-36-14". */
  id: string;
  lat: number;
  lon: number;
  /** "Active signalling with half barriers", "Passive signalling"... */
  kind: string;
  /** Postcode and municipality as Infrabel lists them. */
  place: string;
}

declare module "../../app/core/plugin" {
  interface EntityKinds {
    vehicle: TripSegment;
    stop: TransitStop;
    train: TrainRef;
    trip: TripRef;
    railwork: RailWork;
    crossing: LevelCrossing;
  }
}
