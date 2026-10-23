/** Payloads served by /api/power: the European grid frequency, generation, prices and Belgium's border flows. */

/**
 * Countries the Power screen can show. Italy and Belgium come first; the rest are the neighbours
 * that share the continental grid. `zones` are the day-ahead bidding zones of each country.
 */
export const COUNTRIES = [
  { code: "it", name: "Italy", zones: ["IT-North", "IT-Centre-North", "IT-Centre-South", "IT-South", "IT-Sicily", "IT-Sardinia"] },
  { code: "be", name: "Belgium", zones: ["BE"] },
  { code: "fr", name: "France", zones: ["FR"] },
  { code: "de", name: "Germany", zones: ["DE-LU"] },
  { code: "nl", name: "Netherlands", zones: ["NL"] },
  { code: "es", name: "Spain", zones: ["ES"] },
  { code: "pt", name: "Portugal", zones: ["PT"] },
  { code: "ch", name: "Switzerland", zones: ["CH"] },
  { code: "at", name: "Austria", zones: ["AT"] },
  { code: "pl", name: "Poland", zones: ["PL"] },
] as const;

export type CountryCode = (typeof COUNTRIES)[number]["code"];
export type Zone = (typeof COUNTRIES)[number]["zones"][number];

export const COUNTRY_CODES = COUNTRIES.map((c) => c.code) as [CountryCode, ...CountryCode[]];
export const ZONES = COUNTRIES.flatMap((c) => c.zones) as [Zone, ...Zone[]];

// ── Frequency (Energy-Charts, measured by Fraunhofer ISE) ─────────

/** A sudden fall that does not line up with a quarter-hour schedule change: likely a plant or line tripping. */
export interface FrequencyDip {
  /** Unix seconds when the frequency crossed the threshold. */
  at: number;
  /** How far below its recent level the frequency fell, in millihertz. */
  depthMhz: number;
}

export interface FrequencyData {
  /** Unix seconds, one reading per second (gaps possible). */
  t: number[];
  hz: number[];
  /** Dips in the last few hours, not only in the returned slice. */
  dips: FrequencyDip[];
  /** Seconds between the newest reading and now. */
  lagS: number;
}

// ── Generation mix ────────────────────────────────────────────────

export type MixGroup = "solar" | "wind" | "hydro" | "bio" | "geothermal" | "nuclear" | "gas" | "coal" | "oil" | "storage" | "other";

export interface MixSeries {
  id: MixGroup;
  label: string;
  renewable: boolean;
  /** Megawatts for each timestamp; 0 when the source has no reading. */
  mw: number[];
}

export interface PowerMix {
  country: CountryCode;
  /** Unix seconds, start of each interval. The last one is the newest interval with a full set of readings. */
  t: number[];
  stepS: number;
  series: MixSeries[];
  /** Demand in MW; null where not yet reported. */
  load: (number | null)[];
  /** Renewable share of generation, percent. */
  renewableShare: (number | null)[];
  /** Estimated lifecycle CO2 of the generation mix, g per kWh. */
  co2: (number | null)[];
}

// ── Prices and the green/red signal ───────────────────────────────

export interface PricePoints {
  zone: Zone;
  unit: string;
  /** Unix seconds, start of each interval (15 minutes). */
  t: number[];
  eurMwh: number[];
  /** What the source says you may do with the numbers. */
  licence: string;
}

export interface GreenSignal {
  country: CountryCode;
  t: number[];
  /** Renewable share of demand, percent. */
  share: number[];
  /** 2 green, 1 average, 0 red (little renewable power), -1 red (grid congestion). */
  signal: number[];
  /** True when the source guessed from history because forecasts were missing. */
  substitute: boolean;
}

// ── Belgium (Elia Open Data) ──────────────────────────────────────

export type Border = "France" | "Germany" | "Netherlands" | "Luxembourg" | "United Kingdom";

export interface BorderFlow {
  border: Border;
  /** Newest reading in MW. Positive: Belgium exports. Negative: Belgium imports. */
  mw: number;
  /** Unix seconds, start of the 15-minute interval. */
  at: number;
  /** Earlier readings, oldest first. */
  history: { t: number; mw: number }[];
}

export interface Imbalance {
  at: number;
  /** MW. Positive: more power fed in than used. Negative: a shortfall. */
  mw: number;
  /** Area control error in MW: the gap between scheduled and actual exchange. */
  ace: number | null;
  series: { t: number; mw: number }[];
}

export interface BelgiumGrid {
  flows: BorderFlow[];
  imbalance: Imbalance | null;
}

export interface TieLine {
  id: string;
  name: string;
  border: Border;
  /** Share of the line's rating in use at `LineMap.at`, percent. */
  loading: number | null;
  /** [lon, lat] points from the Belgian end to the foreign end. */
  coords: [number, number][];
}

export interface LineMap {
  /** Unix seconds of the loading readings (Elia publishes them with a delay of about a day). */
  at: number;
  /** Lines inside Belgium. */
  internal: { id: string; name: string; loading: number | null; coords: [number, number][] }[];
  ties: TieLine[];
}

// ── Belgian nuclear fleet (Elia unavailability data) ──────────────

/** One stretch when a reactor cannot give its full power. */
export interface NuclearOutage {
  /** Unix seconds. */
  from: number;
  /** Unix seconds; null when Elia lists no end (the date is a placeholder far in the future). */
  until: number | null;
  /** Megawatts the reactor can still give during the outage. */
  availableMw: number;
  /** "Planned" outages are announced ahead; "Forced" ones are not. */
  type: "Planned" | "Forced";
  /** Elia's words, e.g. "Planned maintenance". */
  reason: string;
}

export interface Reactor {
  /** Elia's unit name, e.g. "DOEL 4". */
  unit: string;
  site: "Doel" | "Tihange";
  capacityMw: number;
  availableMw: number;
  status: "available" | "reduced" | "offline";
  /** The outage in force now, when there is one. */
  current: NuclearOutage | null;
  /** Outages in force now and announced, oldest first, with overlapping notices merged. */
  outages: NuclearOutage[];
}

export interface NuclearFleet {
  /** Unix seconds of the newest notice Elia published. */
  at: number;
  reactors: Reactor[];
  /** Units that appear in Elia's outage history but not in its current list of nuclear units. */
  retired: string[];
}

// ── Gas pipelines (ENTSOG transparency platform) ──────────────────

export type GasCountry = "IT" | "BE";

export interface GasSite {
  id: string;
  name: string;
  country: GasCountry;
  kind: "pipeline" | "lng";
  /** Where the gas comes from, in a few words. */
  origin: string;
  lat: number;
  lon: number;
  /** Compass bearing of the gas when it flows into the country. */
  bearing: number;
  /** Net flow into the country in GWh per hour, from the newest hour with a reading; negative means it flows out. */
  gwh: number;
  /** Unix seconds, start of that hour. */
  at: number;
  /** The last two days, hourly, oldest first. */
  series: { t: number; gwh: number }[];
}

export interface GasFlows {
  /** Unix seconds of the newest hour any site reports. */
  at: number;
  sites: GasSite[];
}

// ── Power cuts (Liander, Amsterdam region) ────────────────────────

export interface PowerCut {
  id: string;
  /** "fault" is an unplanned outage, "planned" is announced work. */
  type: "fault" | "planned";
  status: "pending" | "on-the-way" | "on-site" | "fixed";
  /** The status in plain words: "Crew on the way". */
  statusText: string;
  /** Cause in plain words, e.g. "Digging work". */
  causeText: string;
  /** The operator reports a bucket, never a count: "fewer than 100". */
  customers: string;
  streets: string[];
  /** Unix seconds. */
  reported: number;
  estimatedFix: number | null;
  fixed: number | null;
  /** Centre of the affected area. */
  lat: number;
  lon: number;
}

export interface PowerCuts {
  /** Unix seconds of the newest update Liander posted. */
  at: number;
  cuts: PowerCut[];
  /** The affected areas, one feature per cut with `id` in its properties. */
  areas: GeoJSON.FeatureCollection;
}

declare module "../../app/core/plugin" {
  interface EntityKinds {
    gaspoint: GasSite;
    powercut: PowerCut;
  }
}
