/** Pure physics and wording shared by the server (facts, link distances) and the screens. */

export const LIGHT_KM_S = 299_792.458;
export const AU_KM = 149_597_870.7;
const YEAR_S = 365.25 * 86_400;
/** Planck 2018 result, rounded. */
const UNIVERSE_AGE_YEARS = 13.8e9;

export type UnitSystem = "metric" | "imperial";

export const lightSecondsOver = (km: number): number => km / LIGHT_KM_S;

/** dBm is decibels relative to one milliwatt. */
export const dbmToWatts = (dbm: number): number => 10 ** (dbm / 10) / 1000;

/** Two significant figures for large numbers, one decimal in the middle, one significant figure below 1. */
function approx(n: number): string {
  if (n >= 100) return String(Math.round(n / 10) * 10);
  if (n >= 10) return String(Math.round(n));
  if (n >= 1) return String(Math.round(n * 10) / 10);
  return n.toPrecision(1);
}

/** `floor` is the smallest power that still reads in this unit; below it the next, finer unit takes over. */
const POWER_SCALES: readonly { watts: number; floor: number; one: string; many: string }[] = [
  { watts: 1, floor: 1, one: "watt", many: "watts" },
  { watts: 1e-3, floor: 1e-3, one: "thousandth of a watt", many: "thousandths of a watt" },
  { watts: 1e-6, floor: 1e-6, one: "millionth of a watt", many: "millionths of a watt" },
  { watts: 1e-9, floor: 1e-9, one: "billionth of a watt", many: "billionths of a watt" },
  { watts: 1e-12, floor: 1e-12, one: "trillionth of a watt", many: "trillionths of a watt" },
  { watts: 1e-15, floor: 1e-15, one: "millionth of a billionth of a watt", many: "millionths of a billionth of a watt" },
  // Down to a tenth of a billionth of a billionth the number stays a decimal; Voyager's signal is below that.
  { watts: 1e-18, floor: 1e-19, one: "billionth of a billionth of a watt", many: "billionths of a billionth of a watt" },
  { watts: 1e-21, floor: 0, one: "trillionth of a billionth of a watt", many: "trillionths of a billionth of a watt" },
];

/** A received power in plain words: -155 dBm is "about 0.3 billionths of a billionth of a watt". */
export function powerWords(dbm: number): string {
  const watts = dbmToWatts(dbm);
  const last = POWER_SCALES[POWER_SCALES.length - 1] as (typeof POWER_SCALES)[number];
  // The tolerance keeps a value that is one unit up to rounding (a power of ten computed from dBm) on the larger scale: "1 billionth", not "1000 trillionths".
  const scale = POWER_SCALES.find((s) => watts >= s.floor * 0.9995) ?? last;
  const n = approx(watts / scale.watts);
  return `about ${n} ${n === "1" ? scale.one : scale.many}`;
}

function longYears(years: number): string {
  if (years < 1_000) return `${approx(years)} years`;
  if (years < 1e6) return `${approx(years / 1e3)} thousand years`;
  if (years < 1e9) return `${approx(years / 1e6)} million years`;
  if (years < 1e12) return `${approx(years / 1e9)} billion years`;
  return `${approx(years / 1e12)} trillion years`;
}

/**
 * How long a receiver at this power needs to collect one joule (the energy to lift a small apple by a metre).
 * Null when that takes less than a year, because then the comparison stops being surprising.
 */
export function joulePatience(dbm: number): string | null {
  const years = 1 / dbmToWatts(dbm) / YEAR_S;
  if (years < 1) return null;
  const ages = years / UNIVERSE_AGE_YEARS;
  const compare = ages >= 1.5 ? `, about ${approx(ages)} times the age of the universe` : "";
  return `At that power a dish needs about ${longYears(years)} to collect one joule${compare}. One joule lifts a small apple by a metre.`;
}

/** "4.6 s", "12 min 40 s", "23 h 54 min". */
export function lightTimeWords(seconds: number): string {
  if (seconds < 10) return `${seconds.toFixed(1)} s`;
  if (seconds < 60) return `${Math.round(seconds)} s`;
  const total = Math.round(seconds);
  if (total < 3_600) {
    const m = Math.floor(total / 60);
    const s = total % 60;
    return m < 20 ? `${m} min ${s} s` : `${m} min`;
  }
  const h = Math.floor(total / 3_600);
  return `${h} h ${Math.floor((total % 3_600) / 60)} min`;
}

/** "Signal left 23 h 54 min ago". */
export const signalLeftWords = (seconds: number): string => `Signal left ${lightTimeWords(seconds)} ago`;

const MILE_KM = 1.609344;

/** A distance split into its number and unit, for places that style them apart: "25.9" and "billion km". */
export function distanceParts(km: number, units: UnitSystem): { value: string; unit: string } {
  const n = units === "imperial" ? km / MILE_KM : km;
  const unit = units === "imperial" ? "miles" : "km";
  const one = (v: number): string => (Math.round(v * 10) / 10).toLocaleString("en-US", { maximumFractionDigits: 1 });
  if (n >= 1e9) return { value: one(n / 1e9), unit: `billion ${unit}` };
  if (n >= 1e6) return { value: one(n / 1e6), unit: `million ${unit}` };
  return { value: Math.round(n).toLocaleString("en-US"), unit };
}

/** "384,000 km", "150 million km", "25.9 billion km", or the same in miles. */
export function distanceWords(km: number, units: UnitSystem): string {
  const { value, unit } = distanceParts(km, units);
  return `${value} ${unit}`;
}

export const toAu = (km: number): number => km / AU_KM;

/** IEEE letter bands, as the Deep Space Network reports them. */
export function bandWords(band: string): string {
  switch (band.toUpperCase()) {
    case "S":
      return "S band · 2–4 GHz";
    case "X":
      return "X band · 8–12 GHz";
    case "K":
      return "K band · 18–27 GHz";
    case "KA":
      return "Ka band · 27–40 GHz";
    default:
      return `${band} band`;
  }
}

/** Length of a 3-vector. */
export const norm3 = (v: readonly [number, number, number]): number => Math.hypot(v[0], v[1], v[2]);
