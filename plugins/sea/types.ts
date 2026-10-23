/** Payloads served by /api/sea: tide gauges from the IOC Sea Level Station Monitoring facility and Argo floats from Euro-Argo. */

/**
 * How the sea behaves at a gauge, judged against that gauge's own usual noise. "restless" is a visible swing, "normal" is within what the gauge does every day,
 * "unusual" a large one. Neither is a tsunami warning.
 */
export type SeaLevel = "normal" | "restless" | "unusual";

export interface Gauge {
  /** The station code the IOC uses, e.g. "CI20". */
  code: string;
  name: string;
  country: string;
  lat: number;
  lon: number;
  /** Minutes between readings. One minute at most Italian ports, five at the Belgian coast. */
  intervalMin: number;
  /** Latest reading in metres, measured from the gauge's own zero (not from mean sea level). */
  valueM: number;
  /** When that reading was taken, epoch milliseconds. */
  at: number;
  /** Null when the gauge has not been analysed for this answer. */
  level: SeaLevel | null;
}

export type SwingKind = "oscillation" | "step";

/** The biggest swing in a stretch of data once the tide is taken out. */
export interface Swing {
  level: SeaLevel;
  /** Highest minus lowest tide-free level inside a 30-minute window, in metres. */
  rangeM: number;
  /** The 30-minute window, epoch milliseconds. */
  from: number;
  to: number;
  /** Back-and-forth movement, or a one-way jump. */
  kind: SwingKind;
  /** Time from one crest to the next, when the swing repeats at least twice. */
  periodMin: number | null;
}

export interface GaugeAnalysis {
  /** The strongest swing in the last 90 minutes. */
  recent: Swing;
  /** The strongest swing in the 24 hours. */
  day: Swing;
  /** This gauge's usual 30-minute swing (the quietest quarter of the day), in metres. */
  quietM: number;
  /** True when readings are too far apart to see quick oscillations, so the gauge can say "restless" but never "unusual". */
  coarse: boolean;
}

/** Twenty-four hours of one gauge: the level, and the level with the tide taken out. Millimetres on a one-minute grid; null where there is no reading. */
export interface GaugeReading {
  gauge: Gauge;
  startMs: number;
  stepMs: number;
  levelMm: (number | null)[];
  tideFreeMm: (number | null)[];
  analysis: GaugeAnalysis;
}

/** A gauge that is not calm right now. */
export interface GaugeAlert {
  gauge: Gauge;
  analysis: GaugeAnalysis;
}

export interface GaugeAlerts {
  /** How many gauges were checked. */
  checked: number;
  alerts: GaugeAlert[];
}

// ── Argo floats ───────────────────────────────────────────────────

/** An Argo float as the map shows it: where it last came up and how deep its last dive went. */
export interface ArgoFloat {
  /** The float's WMO number. */
  platform: string;
  cycle: number;
  /** When the last profile was taken, epoch milliseconds. */
  time: number;
  lat: number;
  lon: number;
  /** Deepest point of that dive, in decibars (about one metre each). */
  maxPresDbar: number;
}

export interface ArgoLevel {
  presDbar: number;
  tempC: number;
  /** Salinity in practical salinity units; null when the float has no good reading. */
  psal: number | null;
}

export interface ArgoCycle {
  cycle: number;
  time: number;
  lat: number;
  lon: number;
}

/** The latest dive of one float, with the path it drifted since its earlier dives. */
export interface ArgoProfile {
  platform: string;
  latest: ArgoCycle & { levels: ArgoLevel[] };
  /** Earlier dives, oldest first, each with the place where the float came up. */
  history: ArgoCycle[];
  /** Typical days between dives, from the float's own history; null with fewer than two dives. */
  cycleDays: number | null;
}

declare module "../../app/core/plugin" {
  interface EntityKinds {
    tidegauge: Gauge;
    argo: ArgoFloat;
  }
}
