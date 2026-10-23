/** Payloads served by /api/weather (Open-Meteo forecast and air quality, RainViewer radar). */

export interface WeatherNow {
  time: string;
  tempC: number;
  feelsC: number;
  humidity: number;
  precipMm: number;
  /** WMO weather interpretation code. */
  code: number;
  cloud: number;
  windKmh: number;
  windDeg: number;
  gustKmh: number;
  pressureHpa: number;
  isDay: boolean;
  uv: number;
}

export interface HourForecast {
  time: string;
  tempC: number;
  precipProb: number;
  precipMm: number;
  code: number;
}

export interface AirQuality {
  europeanAqi: number | null;
  usAqi: number | null;
  pm25: number | null;
  pm10: number | null;
  no2: number | null;
  ozone: number | null;
  /** Grains per m³ by plant; only covered regions report pollen. */
  pollen: Record<string, number>;
}

export interface Weather {
  timezone: string;
  now: WeatherNow;
  hours: HourForecast[];
  /** Precipitation in 15-minute steps for the next two hours, where available. */
  nowcast: { time: string; mm: number }[];
  air: AirQuality | null;
}

export interface RadarFrames {
  host: string;
  frames: { time: number; path: string }[];
}

// ── Official warnings (MeteoAlarm and Italy's Civil Protection Department) ─────

export type WarningLevel = "yellow" | "orange" | "red";
export type WarningSource = "meteoalarm" | "dpc";

export interface OfficialWarning {
  /** Unique across sources. */
  id: string;
  source: WarningSource;
  level: WarningLevel;
  /** What the warning is about, in plain words: "Thunderstorms", "Wind". */
  hazard: string;
  /** The named area it applies to: a province, a region or a civil-protection zone. */
  area: string;
  /** Two-letter country code. */
  country: string;
  /** Who issued it, as written in the feed. */
  issuer: string;
  /** Unix seconds. */
  from: number;
  until: number;
  /** What the issuer says is expected. */
  text: string | null;
  advice: string | null;
  url: string | null;
  /** How many municipalities the zone has (Italian civil-protection zones only); /api/weather/municipalities lists them. */
  municipalityCount: number | null;
  /** Key into `OfficialWarnings.areas`; null when no outline is known for this area. */
  areaId: string | null;
}

export interface WarningArea {
  id: string;
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon;
}

export interface OfficialWarnings {
  fetchedAt: number;
  /** Countries whose warnings were requested. */
  countries: string[];
  warnings: OfficialWarning[];
  areas: WarningArea[];
  /** Ids of warnings whose area contains the position that was sent with the request. */
  covering: string[];
  /** Feeds that failed while the others worked. */
  failed: { source: string; message: string }[];
}

/** Entity data for the Profiler: one warning, with enough to describe it without another request. */
export type WarningRef = OfficialWarning;

// ── Satellite loops (EUMETSAT: MTG Lightning Imager and fire detection) ─────

export interface SatelliteFrames {
  /** The area every frame covers; the browser pins the image to these corners. */
  bounds: { west: number; south: number; east: number; north: number };
  /** Minutes between frames. */
  stepMin: number;
  /** Oldest first. Times are ISO 8601 in UTC and are the exact `t` the image route accepts. */
  frames: string[];
}

export interface FireSpots {
  /** ISO time of the satellite frame the detections come from. */
  time: string;
  stepMin: number;
  /** One entry per mark on the satellite picture: a fire, or an industrial flare or volcano hot enough to look like one. */
  spots: { lat: number; lon: number }[];
}

// ── Belgium: RMI weather station network ────────────────────────

export interface CloudLayer {
  heightM: number;
  /** Oktas (eighths of the sky), 1 to 8; 9 means the sky is hidden. */
  oktas: number;
}

export interface Ceilometer {
  station: string;
  distanceKm: number;
  /** ISO time of the reading. */
  at: string;
  /** Height of the lowest cloud the laser hit, in metres above the station; null when it saw none. */
  baseM: number | null;
  layers: CloudLayer[];
}

export interface SoilTemps {
  station: string;
  distanceKm: number;
  at: string;
  airC: number | null;
  /** Temperature under the grass, by depth in centimetres. */
  depths: { cm: number; c: number }[];
}

export interface CrowdReports {
  /** How far around you the nearby count looks, in kilometres. */
  radiusKm: number;
  hours: number;
  nearby: number;
  /** All reports sent from Belgium in the same period. */
  country: number;
  /** What the nearby reports said, most common first. Counts only: no positions leave the server. */
  byKind: { kind: string; count: number }[];
}

export interface BelgiumWeather {
  ceilometer: Ceilometer | null;
  soil: SoilTemps | null;
  crowd: CrowdReports | null;
  /** Parts that could not be read right now, with the reason; a part with no station near is null without an entry here. */
  unavailable: { part: "ceilometer" | "soil" | "crowd"; message: string }[];
}

// ── Alpine snow stations (SLF IMIS) ────────────────────────────

export interface SnowStation {
  code: string;
  name: string;
  lat: number;
  lon: number;
  elevationM: number;
  canton: string | null;
  country: "CH" | "LI";
  /** Snow depth in centimetres at the latest reading; 0 means bare ground. */
  depthCm: number;
  /** Rise over the last six hours above the lowest reading in that window, in centimetres. */
  riseCm: number;
  /** Fresh snow: the depth rose fast enough that it cannot be sensor noise. */
  fresh: boolean;
  airC: number | null;
  /** ISO time of the latest reading. */
  at: string;
}

export interface SnowStations {
  fetchedAt: number;
  /** Stations in the network, including those that only measure wind. */
  networkSize: number;
  stations: SnowStation[];
}

export interface SnowPoint {
  /** Unix seconds. */
  t: number;
  depthCm: number | null;
  airC: number | null;
}

export interface SnowHistory {
  station: SnowStation;
  /** Surface of the snowpack and temperatures inside it at the latest reading. */
  snowpack: { surfaceC: number | null; at25cmC: number | null; at50cmC: number | null; at100cmC: number | null };
  /** Half-hourly readings over seven days, oldest first. */
  series: SnowPoint[];
}

declare module "../../app/core/plugin" {
  interface EntityKinds {
    warning: WarningRef;
    snowstation: SnowStation;
  }
}
