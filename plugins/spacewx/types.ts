/** Payloads served by /api/spacewx. */

/** One block of the page can fail while the others work, so each reports its own outcome. */
export type Section<T> = { ok: true; data: T } | { ok: false; error: string };

// ── Geomagnetic activity ──────────────────────────────────────────

export interface KpSlot {
  /** Start of the three-hour block, ms since epoch. */
  at: number;
  kp: number;
  kind: "observed" | "estimated" | "predicted";
  /** NOAA G-scale storm level, 0 (no storm) to 5. */
  scale: number;
}

export interface KpInfo {
  /** Real-time estimate of the planetary K index. */
  now: number;
  at: number;
  scale: number;
  /** Three-hour blocks from the start of today (UTC) through the end of the NOAA forecast. */
  slots: KpSlot[];
}

// ── Solar wind ────────────────────────────────────────────────────

export interface WindSample {
  at: number;
  /** Proton speed, km/s. */
  speed: number | null;
  /** Proton density, per cubic centimetre. */
  density: number | null;
  /** North–south field component in GSM coordinates, nT. Negative (southward) couples to Earth's field. */
  bz: number | null;
}

export interface WindInfo {
  at: number;
  speedKmS: number | null;
  densityCm3: number | null;
  bzNt: number | null;
  /** The past three hours, one sample every few minutes. */
  series: WindSample[];
  /** Spacecraft sitting upstream of Earth that measured it. */
  source: string;
}

// ── Solar flares ──────────────────────────────────────────────────

export interface XrayInfo {
  at: number;
  /** Long-channel (0.1–0.8 nm) flux in W/m². */
  fluxWm2: number;
  /** Flare class of the current flux: "B3.2", "C1.1", "M6.7", "X1.0". */
  class: string;
  /** The past six hours, thinned. */
  series: { at: number; flux: number }[];
  flare: { class: string; beganAt: number; peakAt: number; endedAt: number | null } | null;
}

export interface SpaceWeatherNow {
  fetchedAt: number;
  kp: Section<KpInfo>;
  wind: Section<WindInfo>;
  xray: Section<XrayInfo>;
}

// ── Aurora ────────────────────────────────────────────────────────

export interface AuroraPoint {
  observedAt: number;
  /** The time the model predicts for; about 30 to 90 minutes after the observation. */
  forecastAt: number;
  /** Probability of visible aurora overhead, percent. */
  chancePct: number;
  /** Highest probability anywhere on Earth. */
  peakPct: number;
  /** Latitude of the oval's equatorward edge near your meridian (10 % chance overhead), signed for your hemisphere; null when no aurora reaches 10 %. */
  edgeLat: number | null;
  /** Latitude down to which aurora can be seen low on the horizon, a few degrees beyond the edge. Same sign convention. */
  reachLat: number | null;
}

export interface AuroraGrid {
  observedAt: number;
  forecastAt: number;
  width: number;
  height: number;
  /** One byte per cell (percent), base64. Row 0 is latitude −90°; column 0 is longitude 0°, going east. */
  cells: string;
}

// ── Asteroids and fireballs ───────────────────────────────────────

export interface Approach {
  /** Designation, e.g. "2026 TB5". */
  name: string;
  /** Closest approach to Earth's centre, ms since epoch. */
  at: number;
  /** Uncertainty of that time in minutes; null when under a minute or unknown. */
  timeSigmaMin: number | null;
  distAu: number;
  distKm: number;
  /** Distance as a multiple of the Moon's distance. */
  distLd: number;
  velKmS: number;
  /** Absolute magnitude: lower is bigger. */
  h: number | null;
  /** Diameter range in metres. Measured when `measured`, otherwise estimated from H for albedo 0.05–0.25. */
  sizeM: { min: number; max: number; measured: boolean } | null;
}

export interface AsteroidsInfo {
  fetchedAt: number;
  /** Approaches in the next 30 days closer than 0.05 au, soonest first. */
  approaches: Approach[];
}

export interface Fireball {
  id: string;
  at: number;
  lat: number;
  lon: number;
  /** Impact energy, kilotons of TNT. */
  kt: number;
  /** Total energy radiated as light, joules. */
  radiatedJ: number;
  altKm: number | null;
  velKmS: number | null;
}

// ── Earth's shields ───────────────────────────────────────────────

/** One neutron monitor's week of hourly counts, as percent change from its own median. */
export interface RayStation {
  code: "ROME" | "DRBS";
  name: string;
  lat: number;
  lon: number;
  /** Median count rate over the week, counts per second. This is the zero line of the chart. */
  baselineCps: number;
  /** Hourly points, oldest first. `at` is the start of the hour. */
  points: { at: number; pct: number }[];
  /** The newest hourly reading. */
  latest: { at: number; cps: number; pct: number };
}

/** A sudden drop in cosmic rays, as seen at the monitor with the deepest drop and confirmed by the other. */
export interface ForbushDecrease {
  /** When the counts began to fall: the last high before the drop. */
  onsetAt: number;
  /** When the counts were lowest. */
  lowAt: number;
  /** Depth at the deepest monitor, percent below its level before the drop. */
  depthPct: number;
  /** The monitor that saw the deepest drop. */
  code: RayStation["code"];
  /** Last time the counts were still clearly low (1.5 % or more below the old level). */
  untilAt: number;
  /** True when the newest reading is still low. */
  ongoing: boolean;
}

export interface CosmicRays {
  stations: RayStation[];
  forbush: ForbushDecrease | null;
  /** Wording NMDB asks every user of its data to show. */
  acknowledgement: string;
}

export type FieldLevel = "calm" | "unsettled" | "active" | "storm";

/** Disturbance of the horizontal magnetic field at one INTERMAGNET observatory over 24 hours. */
export interface FieldInfo {
  code: string;
  name: string;
  lat: number;
  lon: number;
  distanceKm: number;
  /** Newest valid minute, ms since epoch. */
  at: number;
  /** Horizontal field strength now, nanotesla. */
  hNt: number;
  /** Change of the horizontal field from the window's median, five-minute means, oldest first. */
  series: { at: number; dNt: number }[];
  /** Largest swing of the field in the last three hours, nanotesla. */
  range3hNt: number;
  level: FieldLevel;
  /** Nearer observatories that had no data from the last three hours, or failed to answer (with the reason). */
  skipped: string[];
}

export interface BandReach {
  /** Band name, e.g. "20 m". */
  name: string;
  mhz: number;
  /** `near`: signals bounce even from straight overhead. `skip`: they land only beyond `fromKm`. `closed`: they pass through the layer. */
  state: "near" | "skip" | "closed";
  /** Where a bounced signal first lands, km from the transmitter. Zero for `near`. */
  fromKm: number;
  /** The furthest a single bounce reaches, km. */
  toKm: number;
}

export interface Ionosonde {
  code: string;
  name: string;
  distanceKm: number;
  /** Time of the sounding, ms since epoch. */
  at: number;
  /** Highest frequency the layer reflects from straight above, MHz. */
  foF2: number;
  /** Height of the reflecting layer, km. */
  hmF2: number;
  /** Highest frequency that bounces on a 3,000 km path, MHz. */
  muf3000: number;
}

export interface IonosphereInfo {
  /** The ionosonde nearest to you; the band table describes the sky above it. */
  main: Ionosonde;
  /** Another station for comparison (Rome or Dourbes), when it reported lately. */
  other: Ionosonde | null;
  bands: BandReach[];
}

export interface Shields {
  fetchedAt: number;
  cosmic: Section<CosmicRays>;
  field: Section<FieldInfo>;
  sky: Section<IonosphereInfo>;
}

/** Entity data for the Profiler. */
export type FireballRef = Fireball;

declare module "../../app/core/plugin" {
  interface EntityKinds {
    fireball: FireballRef;
  }
}
