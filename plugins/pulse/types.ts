/** Payloads served by /api/pulse. Shared by api.ts (server) and the browser code. */

// ── Traffic lights (Hamburg, OGC SensorThings) ────────────────────

/** Signal state codes published by Hamburg: 0 dark, 1 red, 2 amber, 3 green, 4 red-amber, 5 amber flashing, 6 green flashing, 9 unknown. */
export type SignalCode = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 9;

export type LaneKind = "vehicle" | "bus" | "cycle" | "pedestrian";

export interface SignalHead {
  /** SensorThings datastream id of the primary signal; the id of the live stream. */
  id: number;
  /** Lane connection ("91_15"), the thing that owns this head and its detectors. */
  thing: number;
  name: string;
  junction: string;
  group: string | null;
  lane: LaneKind;
  lat: number;
  lon: number;
  /** The path the lane takes through the junction, [lon, lat] pairs. */
  route: [number, number][] | null;
}

export interface SignalHeads {
  heads: SignalHead[];
  /** Heads that report live inside the view, before the cap. */
  total: number;
  capped: boolean;
}

/** One line of the signal stream (NDJSON). */
export type SignalStreamEvent =
  | { t: "state"; id: number; v: number | boolean; at: number }
  | { t: "transport"; transport: "mqtt" | "poll" }
  | { t: "ping"; at: number };

export type DetectorKind = "car" | "cycle" | "pedestrian" | "acoustic-request" | "bus-pre" | "bus-request" | "bus-checkout" | "secondary" | "acoustic";

export interface SignalStream {
  id: number;
  name: string;
  /** Raw SensorThings layer name, e.g. "primary_signal". */
  layer: string;
  kind: DetectorKind | "primary" | "program";
  value: number | boolean | null;
  at: number | null;
}

export interface SignalDetail {
  thing: number;
  name: string;
  junction: string;
  laneType: string;
  ingressLane: string | null;
  egressLane: string | null;
  primary: number;
  group: string | null;
  lat: number;
  lon: number;
  /** Every stream of this lane connection worth subscribing to, with its latest value. */
  streams: SignalStream[];
  /** State changes of the primary signal in the last few minutes, oldest first. The first entry may predate the window. */
  history: { v: number; at: number }[];
}

/** Entity data for the Profiler. */
export interface SignalRef {
  head: SignalHead;
}

// ── Dutch movable bridges (NDW) ───────────────────────────────────

export interface BridgeOpening {
  /** "reported": the bridge reports itself open. "window": a planned opening is running now. "planned": it starts later. */
  phase: "reported" | "window" | "planned";
  from: number;
  /** Null when no end is announced. */
  until: number | null;
}

export interface Bridge {
  /** RIS-index code of the bridge, shared by every opening of it. */
  code: string;
  name: string | null;
  lat: number;
  lon: number;
  /** The opening that is under way now, if any. */
  now: BridgeOpening | null;
  /** Planned openings still to come, soonest first. */
  upcoming: BridgeOpening[];
}

export interface BridgeFeed {
  bridges: Bridge[];
  /** When NDW published the schedule. */
  publishedAt: number;
}

export interface BridgeRef {
  bridge: Bridge;
}

// ── NDW motorway matrix signs ─────────────────────────────────────

/** What a lane sign shows. Blank signs are not reported. */
export type MatrixDisplay =
  /** `enforced` is the red ring: a legal limit rather than advice. */
  | { kind: "speed"; value: number; flashing: boolean; enforced: boolean }
  | { kind: "closed"; flashing: boolean }
  | { kind: "open"; flashing: boolean }
  /** The lane ends ahead; traffic merges to the given side. */
  | { kind: "ahead"; direction: "left" | "right"; flashing: boolean }
  | { kind: "end"; flashing: boolean }
  | { kind: "other"; label: string; flashing: boolean };

/** What one lane of a gantry shows. */
export interface MatrixLane {
  lane: number;
  display: MatrixDisplay;
  /** When this lane's sign last changed. */
  since: number;
}

/** A gantry over the motorway, with a sign above each lane that shows something. */
export interface MatrixGantry {
  id: string;
  road: string;
  /** Kilometre post along the road. */
  km: number;
  lat: number;
  lon: number;
  lanes: MatrixLane[];
}

export interface MatrixFeed {
  gantries: MatrixGantry[];
  total: number;
  capped: boolean;
}

export interface MatrixRef {
  gantry: MatrixGantry;
}

// ── Parking ───────────────────────────────────────────────────────

export interface CarPark {
  id: string;
  name: string;
  city: "Ghent" | "Bologna" | "Zurich";
  lat: number;
  lon: number;
  free: number | null;
  capacity: number | null;
  open: boolean;
  /** When the operator last updated this figure. */
  at: number | null;
  detail: string | null;
  url: string | null;
}

export interface ParkingFeed {
  parks: CarPark[];
  /** Cities whose feed failed this time, so the layer can say so. */
  errors: string[];
}

export interface CarParkRef {
  park: CarPark;
}

// ── Counters ──────────────────────────────────────────────────────

export interface CounterSeries {
  /** Start of each bin, epoch ms, oldest first. */
  bins: { at: number; count: number }[];
  /** Length of one bin in minutes. */
  binMinutes: number;
}

export interface Counter {
  id: string;
  name: string;
  city: "Brussels" | "Ghent";
  /** What passes the sensor. */
  counts: "cyclists";
  lat: number;
  lon: number;
  /** Cyclists in the last hour. Null when the source does not publish it live. */
  hour: number | null;
  /** Cyclists so far today (Brussels) or on the latest published day (Ghent). */
  day: number | null;
  /** What `day` refers to. */
  dayLabel: "today" | "latest published day";
  /** When the source last registered a passage or published a bin. */
  at: number | null;
  /** True when the counter delivers within minutes. */
  live: boolean;
}

export interface CounterFeed {
  counters: Counter[];
}

export interface CounterRef {
  counter: Counter;
}

export interface CounterDetail {
  id: string;
  series: CounterSeries;
  /** What the series covers, e.g. "Tuesday 6 Oct". */
  label: string;
}

// ── River levels ──────────────────────────────────────────────────

export type RiverSource = "Waterinfo (Flanders)" | "Hub'Eau (France)" | "ARPA Lombardia";

export interface RiverThresholds {
  /** Metres, same datum as the level. Any may be missing. */
  prewatch: number | null;
  watch: number | null;
  prealarm: number | null;
  alarm: number | null;
}

export type RiverStatus = "normal" | "elevated" | "high" | "unknown";

export interface RiverGauge {
  id: string;
  source: RiverSource;
  name: string;
  river: string | null;
  lat: number;
  lon: number;
  /** Latest level in metres. */
  level: number | null;
  at: number | null;
  thresholds: RiverThresholds | null;
  status: RiverStatus;
  /** Level change over the last 3 hours, in metres. Null when unknown. */
  trend3h: number | null;
  /** Link to the source page for this station, if any. */
  url: string | null;
}

export interface RiverFeed {
  gauges: RiverGauge[];
  /** Sources that failed, so the layer can say so. */
  errors: string[];
}

export interface RiverRef {
  gauge: RiverGauge;
}

export interface RiverSeries {
  id: string;
  points: { at: number; level: number }[];
}

// ── Nearest (home tile) ───────────────────────────────────────────

export interface NearestItem {
  kind: "carpark" | "counter" | "river" | "bridge" | "signal";
  /** Short headline: "Nearest car park: 212 free". */
  title: string;
  detail: string;
  distanceM: number;
  tone: "mint" | "sodium" | "alarm" | "ice";
  lat: number;
  lon: number;
  /** Entity to open in the profiler. */
  entity:
    | { kind: "carpark"; id: string; data: CarParkRef }
    | { kind: "counter"; id: string; data: CounterRef }
    | { kind: "rivergauge"; id: string; data: RiverRef }
    | { kind: "bridgeopening"; id: string; data: BridgeRef }
    | null;
}

export interface Nearest {
  items: NearestItem[];
  /** When there is nothing within range: the closest place that has live city data. */
  closestCovered: { city: string; distanceM: number; /** Degrees clockwise from north, from you to the city. */ bearing: number; feeds: string[] } | null;
}

declare module "../../app/core/plugin" {
  interface EntityKinds {
    signalhead: SignalRef;
    bridgeopening: BridgeRef;
    matrixgantry: MatrixRef;
    carpark: CarParkRef;
    counter: CounterRef;
    rivergauge: RiverRef;
  }
}
