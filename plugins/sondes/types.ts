/** Payloads served by /api/sondes. */

export type SondePhase = "ascending" | "descending" | "floating" | "ground" | "lost";

export interface PathPoint {
  lat: number;
  lon: number;
  altM: number;
  /** Predicted time at this point, ms since epoch. */
  at: number;
}

/** SondeHub's flight prediction for one balloon, from its last position to the ground. */
export interface SondePrediction {
  updatedAt: number;
  /** Predicted path, thinned to a few dozen points. */
  path: PathPoint[];
  /** Predicted burst point; null once the balloon is already coming down. */
  burst: PathPoint | null;
  landing: PathPoint;
}

export interface Sonde {
  /** Serial printed on the sonde and sent in every frame, e.g. "W4214270". */
  serial: string;
  /** Model family reported by the decoder: "RS41", "DFM", "M20" … */
  type: string;
  subtype: string | null;
  manufacturer: string | null;
  lat: number;
  lon: number;
  altM: number;
  /** Horizontal speed over the ground, m/s. */
  speedMs: number | null;
  /** Vertical speed, m/s; negative while falling. */
  vertMs: number | null;
  headingDeg: number | null;
  tempC: number | null;
  humidityPct: number | null;
  pressureHpa: number | null;
  /** Transmit frequency, MHz. */
  frequencyMHz: number | null;
  battV: number | null;
  /** When the last frame was recorded, ms since epoch. */
  seenAt: number;
  phase: SondePhase;
  prediction: SondePrediction | null;
}

export interface SondeSnapshot {
  fetchedAt: number;
  /** False when SondeHub's prediction service did not answer; balloons then carry no prediction. */
  predictionsAvailable: boolean;
  sondes: Sonde[];
}

export interface TrackPoint {
  lat: number;
  lon: number;
  altM: number;
  at: number;
}

export interface SondeTrack {
  serial: string;
  /** Recorded flight path, thinned. */
  points: TrackPoint[];
  /** Highest point, once the balloon has burst and started falling. */
  burst: TrackPoint | null;
  launch: { lat: number; lon: number; at: number; site: { name: string; distanceKm: number } | null };
}

export interface LaunchSite {
  id: string;
  name: string;
  lat: number;
  lon: number;
  altM: number | null;
  /** Nominal observation hours every day, "HH:MM" UTC. Balloons leave about 45 minutes earlier. Empty when unknown. */
  dailyUtc: string[];
  /** Typical burst altitude from past flights, metres. */
  burstAltM: number | null;
  /** Typical ascent rate from past flights, m/s. */
  ascentMs: number | null;
}

/** Entity data for the Profiler: the balloon as last seen. */
export type SondeRef = Sonde & { fetchedAt: number };

// ── Amateur balloons ──────────────────────────────────────────────

/** How a balloon's tracker reports: WSPR (a weak-signal radio mode heard worldwide) or the APRS and Horus networks. */
export type BalloonLink = "WSPR" | "APRS" | "Horus" | "LoRa" | "Other";

/**
 * A balloon launched by radio amateurs. Its call sign names its owner, so it never leaves the server: `id` is
 * an opaque code derived from it, and `name` is a neutral label built from the radio link and that code.
 */
export interface AmateurBalloon {
  id: string;
  name: string;
  link: BalloonLink;
  lat: number;
  lon: number;
  altM: number;
  /** Speed over the ground, m/s. */
  speedMs: number | null;
  /** Temperature the tracker measures, °C. */
  tempC: number | null;
  frequencyMHz: number | null;
  /** Days since launch, when the tracker's registry entry says so. */
  daysAloft: number | null;
  launchDate: string | null;
  /** When it was last heard, ms since epoch. */
  seenAt: number;
  /** Where it has been in the past three days, oldest first. */
  track: TrackPoint[];
}

export interface AmateurSnapshot {
  fetchedAt: number;
  balloons: AmateurBalloon[];
}

/** A balloon's longer flight, up to a year back. */
export interface AmateurFlight {
  id: string;
  points: TrackPoint[];
  /** Days between the first and last position in `points`. */
  spanDays: number;
  /** Times the balloon went round the Earth in that span. Positive eastward, negative westward. */
  laps: number;
  maxAltM: number;
  minAltM: number;
}

declare module "../../app/core/plugin" {
  interface EntityKinds {
    sonde: SondeRef;
    amateurballoon: AmateurBalloon;
  }
}
