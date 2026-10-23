/** Payloads served by /api/hazards: earthquakes (USGS, EMSC, INGV), seismograph traces, disaster alerts (GDACS) and natural events (NASA EONET). */

export type QuakeSource = "USGS" | "EMSC" | "INGV";

export interface Quake {
  id: string;
  mag: number;
  magType: string;
  place: string;
  /** Epoch milliseconds. */
  time: number;
  lat: number;
  lon: number;
  depthKm: number;
  url: string;
  /** Which service this record comes from. When several report the same quake, the most local one wins. */
  source: QuakeSource;
  /** Other services that reported the same quake. */
  alsoIn: QuakeSource[];
  /** "Did you feel it?" reports. */
  felt: number | null;
  /** Modified Mercalli intensity from ShakeMap. */
  mmi: number | null;
  tsunami: boolean;
  /** USGS PAGER impact alert: green, yellow, orange or red. */
  alert: string | null;
  /** True when a seismologist has reviewed it, false when it is automatic, null when the service does not say. */
  reviewed: boolean | null;
}

export type DisasterType = "EQ" | "TC" | "FL" | "VO" | "WF" | "DR";

export interface Disaster {
  id: string;
  type: DisasterType;
  name: string;
  alert: "Green" | "Orange" | "Red";
  lat: number;
  lon: number;
  from: string;
  to: string;
  countries: string;
  severity: string;
  url: string;
}

// ── Seismograph ───────────────────────────────────────────────────

export interface SeismoStation {
  /** "NET.STA", e.g. "BE.UCC". */
  id: string;
  network: string;
  code: string;
  channel: string;
  lat: number;
  lon: number;
  distanceKm: number;
  /** Who runs the instrument, e.g. "INGV" or "Raspberry Shake community". */
  operator: string;
  /** True for a hobbyist's Raspberry Shake, false for an institutional network. */
  citizen: boolean;
}

export interface SeismoTrace {
  station: SeismoStation;
  /** Start and end of the window, epoch milliseconds. */
  startMs: number;
  endMs: number;
  /** Ground velocity in nanometres per second, as a (min, max) pair for every time bin. Bins hold equal slices of the window. */
  bins: [number, number][];
  /** Largest absolute velocity in the window. */
  peakNmS: number;
  /** Typical (root-mean-square) velocity in the window. */
  rmsNmS: number;
  /** Stations tried before this one answered, nearest first. Empty when the nearest one answered. */
  skipped: string[];
}

/** Ground motion at one volcano, from the working INGV seismometer nearest its crater. */
export interface VolcanoSeismo {
  id: string;
  name: string;
  /** What the station's distance is measured from, e.g. "summit craters". */
  summitName: string;
  summit: { lat: number; lon: number };
  /** Null when no station there sent data; `error` then says why. `trace.station.distanceKm` is measured from the summit. */
  trace: SeismoTrace | null;
  error: string | null;
}

// ── NASA EONET ────────────────────────────────────────────────────

export type EonetCategory = "wildfires" | "severeStorms" | "volcanoes" | "seaLakeIce" | "floods" | "dustHaze" | "drought" | "landslides" | "snow" | "tempExtremes" | "waterColor" | "manmade" | "earthquakes";

export interface EonetEvent {
  id: string;
  title: string;
  category: EonetCategory;
  categoryTitle: string;
  lat: number;
  lon: number;
  /** Date of the latest position, ISO. */
  date: string;
  /** Latest measured size, e.g. 55 kts for a storm or 1200 acres for a fire. */
  magnitude: { value: number; unit: string } | null;
  /** Earlier positions, oldest first (storms and icebergs move). */
  track: [number, number][];
  link: string;
  sources: { id: string; url: string }[];
}

declare module "../../app/core/plugin" {
  interface EntityKinds {
    quake: Quake;
    disaster: Disaster;
    eonet: EonetEvent;
  }
}
