/** Payloads served by /api/deepspace. Shared by api.ts (server) and client.ts. */

export type ComplexId = "mdscc" | "gdscc" | "cdscc";

/** A spacecraft as the Deep Space Network and JPL Horizons both name it: the NAIF id is negative for spacecraft. */
export interface SpacecraftRef {
  naifId: number;
  name: string;
}

// ── Deep Space Network ────────────────────────────────────────────

export interface DsnSignal {
  direction: "up" | "down";
  /** The network reports a signal as present only while this is true. */
  active: boolean;
  /** "data", "carrier", "ranging" or "none". */
  type: string;
  /** Radio band letter: S, X, K. */
  band: string;
  /** Bits per second; null when the network does not report one (a bare carrier). */
  rateBps: number | null;
  /** Downlink power received at the dish, in dBm. Null for uplinks and for placeholder values. */
  powerDbm: number | null;
  /** Uplink power sent from the dish, in kilowatts. Null for downlinks. */
  powerKw: number | null;
  spacecraft: SpacecraftRef;
}

export interface DsnTarget {
  spacecraft: SpacecraftRef;
  /** One-way distance reported by the network, rounded; null when it reports none. */
  rangeKm: number | null;
}

export interface DsnDish {
  id: string;
  /** "DSS 54" */
  name: string;
  sizeM: 70 | 34;
  azimuthDeg: number;
  elevationDeg: number;
  windKmh: number | null;
  /** What the dish is doing, in the network's words: "Spacecraft Telemetry, Tracking, and Command". */
  activity: string;
  /** Several dishes combined to hear one faint signal. */
  array: boolean;
  targets: DsnTarget[];
  signals: DsnSignal[];
  /** True when at least one signal on this dish is active. */
  onAir: boolean;
}

export interface DsnComplex {
  id: ComplexId;
  name: string;
  latitude: number;
  longitude: number;
  /** Local time offset from UTC at this complex right now, in minutes (daylight saving included). */
  utcOffsetMin: number;
  dishes: DsnDish[];
}

/** One spacecraft that one complex is talking to or listening to right now. */
export interface DsnLink {
  key: string;
  complexId: ComplexId;
  spacecraft: SpacecraftRef;
  dishIds: string[];
  /** Strongest data downlink first. */
  downlinks: DsnSignal[];
  uplinks: DsnSignal[];
  /** Distance from Earth in km: JPL Horizons when it knows the spacecraft, otherwise the network's own range. */
  distanceKm: number | null;
  distanceSource: "horizons" | "dsn" | null;
  /** One-way light travel time over `distanceKm`, in seconds. */
  lightSeconds: number | null;
}

export interface DsnSnapshot {
  /** The network's own timestamp for this reading, in ms. */
  readingAt: number;
  fetchedAt: number;
  /** Madrid first. */
  complexes: DsnComplex[];
  links: DsnLink[];
}

// ── Solar system ──────────────────────────────────────────────────

export interface SystemBody {
  id: number;
  name: string;
  kind: "planet" | "probe";
  /** Heliocentric position in the ecliptic frame of J2000, in km, extrapolated to `SystemSnapshot.at`. */
  pos: [number, number, number];
  distSunKm: number;
  distEarthKm: number;
  /** Speed relative to the Sun. */
  speedKmS: number;
  /** Rate at which the distance from the Sun grows; negative while falling inward. */
  radialKmS: number;
  /** One-way light travel time from Earth, in seconds. */
  lightSeconds: number;
  /** Time of the JPL solution the position was projected from. */
  epochMs: number;
}

export interface UnavailableBody {
  id: number;
  name: string;
  reason: string;
}

export interface SystemSnapshot {
  at: number;
  bodies: SystemBody[];
  /** Bodies JPL has not answered for yet. Zero when the picture is complete. */
  pending: number;
  unavailable: UnavailableBody[];
}

// ── Profiler ──────────────────────────────────────────────────────

export interface SpacecraftProfile {
  spacecraft: SpacecraftRef;
  /** Null when JPL Horizons has no trajectory for it. */
  body: SystemBody | null;
  /** Why `body` is null: still loading, or JPL has none. */
  bodyNote: string | null;
  links: DsnLink[];
  facts: string[];
}

declare module "../../app/core/plugin" {
  interface EntityKinds {
    spacecraft: SpacecraftRef;
  }
}
