import { distanceM, type LatLon } from "../../shared/geo";
import { levelOf, PM25_WARN, RADIATION_ALERT } from "./scales";
import type { Reading, Sensor, StreetReport } from "./types";

/** Turn upstream records into `Sensor`s. Pure, so the edge cases (indoor units, broken readings, several instruments per place) are tested. */

// ── Sensor.Community ──────────────────────────────────────────────

export interface ScRecord {
  timestamp: string;
  location: { id: number; latitude: string; longitude: string; indoor: number };
  sensor: { id: number; sensor_type: { name: string } };
  sensordatavalues: { value_type: string; value: string | number | null }[];
}

const NETWORK_SC = "Sensor.Community (volunteers)";

const num = (v: string | number | null | undefined): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

const valueOf = (r: ScRecord, type: string): number | null => num(r.sensordatavalues.find((v) => v.value_type === type)?.value);

/** "2026-10-08 20:16:51" is UTC. */
export const scTime = (stamp: string): number => Date.parse(`${stamp.replace(" ", "T")}Z`);

/** Name of the file group in archive.sensor.community for a sensor type ("SDS011" → "sds011", "DNMS (Laerm)" → "laerm"). */
export function archiveSlug(typeName: string): string {
  return /^dnms/i.test(typeName) ? "laerm" : typeName.toLowerCase().replace(/[^a-z0-9]/g, "");
}

interface Place {
  lat: number;
  lon: number;
  records: ScRecord[];
}

function byLocation(records: ScRecord[]): Map<number, Place> {
  const places = new Map<number, Place>();
  for (const r of records) {
    if (r.location.indoor === 1) continue;
    const lat = Number(r.location.latitude);
    const lon = Number(r.location.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const place = places.get(r.location.id) ?? { lat, lon, records: [] };
    place.records.push(r);
    places.set(r.location.id, place);
  }
  return places;
}

const newest = (records: ScRecord[]): number => Math.max(...records.map((r) => scTime(r.timestamp)));

/** Optical dust sensors saturate near 1000; a reading at the ceiling is a fault, not smog. */
const validPm = (v: number | null): v is number => v !== null && v >= 0 && v < 999;

/** Particulate sensors (SDS011, PMS5003, SPS30 …) with the temperature and humidity of any sensor at the same place. */
export function airSensors(records: ScRecord[]): Sensor[] {
  const out: Sensor[] = [];
  for (const [locationId, place] of byLocation(records)) {
    const dust = place.records.filter((r) => r.sensordatavalues.some((v) => v.value_type === "P2") && validPm(valueOf(r, "P2")));
    const main = dust.sort((a, b) => scTime(b.timestamp) - scTime(a.timestamp))[0];
    if (!main) continue;
    const pm25 = valueOf(main, "P2");
    if (pm25 === null) continue;
    const readings: Reading[] = [{ label: "PM2.5", value: pm25, unit: "µg/m³" }];
    const pm10 = valueOf(main, "P1");
    if (validPm(pm10)) readings.push({ label: "PM10", value: pm10, unit: "µg/m³" });
    const climate = place.records.map((r) => ({ t: valueOf(r, "temperature"), h: valueOf(r, "humidity"), p: valueOf(r, "pressure_at_sealevel") ?? valueOf(r, "pressure") })).find((c) => c.t !== null || c.h !== null);
    if (climate?.t != null && climate.t > -50 && climate.t < 60) readings.push({ label: "Temperature", value: climate.t, unit: "°C" });
    if (climate?.h != null && climate.h >= 0 && climate.h <= 100) readings.push({ label: "Humidity", value: climate.h, unit: "%" });
    if (climate?.p != null && climate.p > 80_000 && climate.p < 110_000) readings.push({ label: "Pressure", value: climate.p / 100, unit: "hPa" });
    out.push({
      id: `sc:${locationId}`,
      kind: "air",
      network: "sensor.community",
      networkName: NETWORK_SC,
      name: null,
      lat: place.lat,
      lon: place.lon,
      value: pm25,
      unit: "µg/m³",
      level: levelOf("air", pm25),
      at: newest([main]),
      live: true,
      readings,
      historyKey: `${archiveSlug(main.sensor.sensor_type.name)}:${main.sensor.id}`,
      distanceM: 0,
    });
  }
  return out;
}

/** Sound-level meters (DNMS): A-weighted equivalent level with the quietest and loudest moment of the interval. */
export function noiseSensors(records: ScRecord[]): Sensor[] {
  const out: Sensor[] = [];
  for (const [locationId, place] of byLocation(records)) {
    const main = place.records.filter((r) => {
      const v = valueOf(r, "noise_LAeq");
      return v !== null && v >= 20 && v <= 140;
    })[0];
    const level = main ? valueOf(main, "noise_LAeq") : null;
    if (!main || level === null) continue;
    const readings: Reading[] = [{ label: "Average", value: level, unit: "dB(A)" }];
    const min = valueOf(main, "noise_LA_min");
    const max = valueOf(main, "noise_LA_max");
    if (min !== null) readings.push({ label: "Quietest moment", value: min, unit: "dB(A)" });
    if (max !== null) readings.push({ label: "Loudest moment", value: max, unit: "dB(A)" });
    out.push({
      id: `sc:${locationId}`,
      kind: "noise",
      network: "sensor.community",
      networkName: NETWORK_SC,
      name: null,
      lat: place.lat,
      lon: place.lon,
      value: level,
      unit: "dB(A)",
      level: levelOf("noise", level),
      at: newest([main]),
      live: true,
      readings,
      historyKey: `laerm:${main.sensor.id}`,
      distanceM: 0,
    });
  }
  return out;
}

// ── BfS ODL (Germany) ─────────────────────────────────────────────

export interface BfsProps {
  id: string;
  name: string;
  site_status: number;
  end_measure: string | null;
  value: number | null;
  value_cosmic: number | null;
  value_terrestrial: number | null;
}

export function bfsSensors(features: { geometry: { coordinates: [number, number] }; properties: BfsProps }[]): Sensor[] {
  const out: Sensor[] = [];
  for (const f of features) {
    const p = f.properties;
    // Stations out of service report no value.
    if (p.site_status !== 1 || p.value === null || !(p.value >= 0) || !p.end_measure) continue;
    const readings: Reading[] = [{ label: "Dose rate", value: p.value, unit: "µSv/h" }];
    if (p.value_cosmic !== null) readings.push({ label: "From cosmic rays", value: p.value_cosmic, unit: "µSv/h" });
    if (p.value_terrestrial !== null) readings.push({ label: "From the ground", value: p.value_terrestrial, unit: "µSv/h" });
    out.push({
      id: `bfs:${p.id}`,
      kind: "radiation",
      network: "bfs",
      networkName: "BfS ODL network (German Federal Office for Radiation Protection)",
      name: p.name,
      lat: f.geometry.coordinates[1],
      lon: f.geometry.coordinates[0],
      value: p.value,
      unit: "µSv/h",
      level: levelOf("radiation", p.value),
      at: Date.parse(p.end_measure),
      live: true,
      readings,
      historyKey: `bfs:${p.id}`,
      distanceM: 0,
    });
  }
  return out;
}

// ── Safecast ──────────────────────────────────────────────────────

export interface SafecastRow {
  value: number;
  unit: string;
  captured_at: string;
  latitude: number;
  longitude: number;
}

/** Cell size for thinning survey points: roughly 300 m. */
const CELL_DEG = 0.003;
/** Some Safecast units are fixed and report every few hours; a reading this fresh counts as live. */
const FRESH_MS = 6 * 3_600_000;

/** Dose-rate readings from volunteers: survey walks and drives, and a few fixed units. The newest reading in each ~300 m cell is kept. */
export function safecastSensors(rows: SafecastRow[], now = Date.now()): Sensor[] {
  const cells = new Map<string, SafecastRow>();
  for (const r of rows) {
    if (r.unit !== "usv" || !(r.value >= 0.01 && r.value <= 5)) continue;
    const key = `${Math.round(r.latitude / CELL_DEG)},${Math.round(r.longitude / CELL_DEG)}`;
    const held = cells.get(key);
    if (!held || Date.parse(r.captured_at) > Date.parse(held.captured_at)) cells.set(key, r);
  }
  return [...cells.values()].map((r) => ({
    id: `safecast:${r.latitude.toFixed(3)},${r.longitude.toFixed(3)}`,
    kind: "radiation" as const,
    network: "safecast" as const,
    networkName: "Safecast (volunteer survey walks and drives)",
    name: now - Date.parse(r.captured_at) < FRESH_MS ? null : `Survey ${new Date(r.captured_at).toLocaleDateString("en-GB", { month: "short", year: "numeric" })}`,
    lat: r.latitude,
    lon: r.longitude,
    value: r.value,
    unit: "µSv/h",
    level: levelOf("radiation", r.value),
    at: Date.parse(r.captured_at),
    live: now - Date.parse(r.captured_at) < FRESH_MS,
    readings: [{ label: "Dose rate", value: r.value, unit: "µSv/h" }],
    historyKey: null,
    distanceM: 0,
  }));
}

// ── Choosing ──────────────────────────────────────────────────────

/** Fill in each sensor's distance from `from`, nearest first. */
export function withDistance(sensors: Sensor[], from: LatLon): Sensor[] {
  return sensors.map((s) => ({ ...s, distanceM: distanceM(from, s) })).sort((a, b) => a.distanceM - b.distanceM);
}

/** A live station farther than this is no longer "near you" for radiation, and a survey reading is shown instead when one is closer. */
export const LIVE_RADIATION_RANGE_M = 300_000;

/**
 * The nearest reading of each kind. For radiation a live station within range wins; otherwise the nearest survey reading
 * within `surveyRangeM` is better than a live station on another continent.
 */
export function street(at: LatLon, air: Sensor[], noise: Sensor[], radiation: Sensor[], surveyRangeM = 30_000): Omit<StreetReport, "fetchedAt" | "radiationAlerts"> {
  const nearestAir = withDistance(air, at);
  const nearestRadiation = withDistance(radiation, at);
  const live = nearestRadiation.find((s) => s.live && s.distanceM <= LIVE_RADIATION_RANGE_M);
  const survey = nearestRadiation.find((s) => !s.live && s.distanceM <= surveyRangeM);
  const pm25Near = nearestAir.filter((s) => s.distanceM <= 2000).sort((a, b) => b.value - a.value)[0] ?? null;
  return {
    at,
    air: nearestAir[0] ?? null,
    noise: withDistance(noise, at)[0] ?? null,
    radiation: live ?? survey ?? nearestRadiation[0] ?? null,
    pm25Near: pm25Near && pm25Near.value > PM25_WARN ? pm25Near : null,
  };
}

/** Live stations within `rangeM` whose latest reading is above the alert level. The caller checks the reading before. */
export function highRadiation(radiation: Sensor[], at: LatLon, rangeM = 20_000): Sensor[] {
  return withDistance(radiation, at).filter((s) => s.live && s.distanceM <= rangeM && s.value > RADIATION_ALERT);
}
