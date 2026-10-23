import type { Reading, SensorKind, SensorLevel } from "./types";

/** What the numbers mean. The thresholds are shared by the map colours, the profiler sentences and the watcher. */

/** PM2.5 above this is unhealthy to breathe for long, and the watcher warns. */
export const PM25_WARN = 55;
/** The WHO 24-hour guideline for PM2.5. */
export const PM25_GUIDELINE = 15;
/** Dose rate above which a station is flagged, in µSv/h. Normal background is about 0.05–0.2. */
export const RADIATION_ALERT = 0.4;
export const RADIATION_NORMAL_MAX = 0.2;

export function levelOf(kind: SensorKind, value: number): SensorLevel {
  switch (kind) {
    case "air":
      return value <= PM25_GUIDELINE ? "fine" : value <= PM25_WARN ? "elevated" : "high";
    case "noise":
      return value < 55 ? "fine" : value < 70 ? "elevated" : "high";
    case "radiation":
      return value < RADIATION_NORMAL_MAX ? "fine" : value < RADIATION_ALERT ? "elevated" : "high";
  }
}

const find = (readings: Reading[], label: string): number | null => readings.find((r) => r.label === label)?.value ?? null;

/** One plain sentence that says whether the value is normal, for the profiler. */
export function sentenceFor(kind: SensorKind, value: number, readings: Reading[], live: boolean): string {
  const level = levelOf(kind, value);
  if (kind === "air") {
    const damp = (find(readings, "Humidity") ?? 0) >= 90;
    const fog = damp ? " The air is very humid, and optical dust sensors read too high in fog and mist, so treat this number with care." : "";
    if (level === "fine") return `${fmtNum(value)} µg/m³ is within the World Health Organization's daily guideline of ${PM25_GUIDELINE} µg/m³: the air is clean.${fog}`;
    if (level === "elevated") return `${fmtNum(value)} µg/m³ is above the World Health Organization's daily guideline of ${PM25_GUIDELINE} µg/m³ but below ${PM25_WARN}. People with asthma or heart disease may notice it; it is common in winter and near busy roads.${fog}`;
    return `${fmtNum(value)} µg/m³ is high: above ${PM25_WARN} µg/m³ the air is unhealthy for everyone over a long time. Smoke from fires, fireworks or wood burning are common causes.${fog}`;
  }
  if (kind === "noise") {
    const feel = value < 40 ? "as quiet as a library" : value < 55 ? "ordinary city background" : value < 70 ? "a busy street" : "loud, such as heavy traffic or machinery next to the sensor";
    return `${fmtNum(value)} dB(A) is ${feel}. The World Health Organization recommends staying below 53 dB(A) from road traffic over a whole day.`;
  }
  const where = live ? "" : " This is from a survey walk or drive in the past, not from a station that keeps measuring.";
  if (level === "fine") return `${value.toFixed(2)} µSv/h is normal background radiation. It usually lies between 0.05 and 0.2 µSv/h and depends on the rock below, the altitude and the weather.${where}`;
  if (level === "elevated") return `${value.toFixed(2)} µSv/h is above the usual 0.05–0.2 range but far below anything that matters for health. Volcanic ground, as around Rome and Naples, is naturally higher, and rain washes natural radon products out of the air and can lift a reading briefly.${where}`;
  return `${value.toFixed(2)} µSv/h is high for background radiation. Check whether stations nearby agree; one station can read high because of a nearby source or a fault.${where}`;
}

export const KIND_TITLE: Record<SensorKind, string> = { air: "Air", noise: "Noise", radiation: "Radiation" };

function fmtNum(v: number): string {
  return v >= 100 ? String(Math.round(v)) : v.toFixed(1);
}
