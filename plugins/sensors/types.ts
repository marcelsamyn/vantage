/** Payloads served by /api/sensors: citizen and official sensors for air, noise and radiation. */

export type SensorKind = "air" | "noise" | "radiation";
export type SensorLevel = "fine" | "elevated" | "high";
export type SensorNetwork = "sensor.community" | "bfs" | "safecast";

export interface Reading {
  label: string;
  value: number;
  unit: string;
}

export interface Sensor {
  /** "sc:<location id>", "bfs:<station id>" or "safecast:<lat>,<lon>". */
  id: string;
  kind: SensorKind;
  network: SensorNetwork;
  /** Who runs the network, in words. */
  networkName: string;
  name: string | null;
  lat: number;
  lon: number;
  /** Headline value: PM2.5 in µg/m³, sound level in dB(A) or dose rate in µSv/h. */
  value: number;
  unit: string;
  level: SensorLevel;
  /** When the value was measured, epoch milliseconds. */
  at: number;
  /** False for Safecast surveys, which are walks and drives from the past and not a station that keeps measuring. */
  live: boolean;
  /** Other readings from the same place, such as PM10, temperature and humidity. */
  readings: Reading[];
  /** Key for /history, or null when the network offers no history. */
  historyKey: string | null;
  /** Distance from the requested point in metres (filled by the server for ordering). */
  distanceM: number;
}

export interface SensorsNear {
  center: { lat: number; lon: number };
  radiusKm: number;
  fetchedAt: number;
  sensors: Sensor[];
  /** Per upstream: which answered. A failing source does not hide the others. */
  sources: { id: string; ok: boolean; error?: string }[];
}

export interface SensorHistory {
  /** Hourly means, oldest first. */
  points: { t: number; v: number }[];
  unit: string;
  /** What the window is: "Last 24 hours" or "Yesterday (UTC)". */
  window: string;
}

/** The nearest sensor of each kind to one point, for the "Your street" tile and the watcher. */
export interface StreetReport {
  at: { lat: number; lon: number };
  fetchedAt: number;
  air: Sensor | null;
  noise: Sensor | null;
  radiation: Sensor | null;
  /** The highest PM2.5 among air sensors within 2 km, only when it is above 55 µg/m³. */
  pm25Near: Sensor | null;
  /** Radiation stations within 20 km above 0.4 µSv/h in two consecutive readings. */
  radiationAlerts: Sensor[];
}

declare module "../../app/core/plugin" {
  interface EntityKinds {
    sensor: Sensor;
  }
}
