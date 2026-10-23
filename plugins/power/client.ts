import { useEffect, useState } from "react";
import { create } from "zustand";
import { api, qs } from "../../app/core/api";
import { fmt } from "../../app/core/format";
import { usePoll, useStoredState, type Polled } from "../../app/core/hooks";
import { useLocation, type Here } from "../../app/core/location";
import type { Place } from "../../shared/location";
import { distanceM, type LatLon } from "../../shared/geo";
import { COUNTRIES, type BelgiumGrid, type Border, type CountryCode, type FrequencyData, type GasFlows, type GreenSignal, type LineMap, type NuclearFleet, type PowerCuts, type PowerMix, type PricePoints, type Zone } from "./types";

// ── Fetchers ──────────────────────────────────────────────────────

export const fetchFrequency = (since: number | null, signal?: AbortSignal): Promise<FrequencyData> => api<FrequencyData>(qs("/api/power/frequency", { since, window: 3600 }), { signal });
export const fetchMix = (country: CountryCode, signal?: AbortSignal): Promise<PowerMix> => api<PowerMix>(qs("/api/power/mix", { country }), { signal });
export const fetchPrice = (zone: Zone, signal?: AbortSignal): Promise<PricePoints> => api<PricePoints>(qs("/api/power/price", { zone }), { signal });
export const fetchSignal = (country: CountryCode, signal?: AbortSignal): Promise<GreenSignal> => api<GreenSignal>(qs("/api/power/signal", { country }), { signal });
export const fetchBelgium = (signal?: AbortSignal): Promise<BelgiumGrid> => api<BelgiumGrid>("/api/power/belgium", { signal });
export const fetchLines = (signal?: AbortSignal): Promise<LineMap> => api<LineMap>("/api/power/lines", { signal });
export const fetchNuclear = (signal?: AbortSignal): Promise<NuclearFleet> => api<NuclearFleet>("/api/power/nuclear", { signal });
export const fetchGas = (signal?: AbortSignal): Promise<GasFlows> => api<GasFlows>("/api/power/gas", { signal });
export const fetchCuts = (signal?: AbortSignal): Promise<PowerCuts> => api<PowerCuts>("/api/power/cuts", { signal });

// ── The frequency series, shared by the screen, the tile and the watcher ──

const KEEP_S = 3 * 3600;

interface FrequencyStore {
  t: number[];
  hz: number[];
  dips: FrequencyData["dips"];
  lagS: number | null;
  ingest: (data: FrequencyData, replace: boolean) => void;
}

export const useFrequencyStore = create<FrequencyStore>((set) => ({
  t: [],
  hz: [],
  dips: [],
  lagS: null,
  ingest: (data, replace) =>
    set((s) => {
      // Several components keep this series fresh, so two requests can return the same seconds: keep each reading once.
      const known = replace ? -Infinity : (s.t[s.t.length - 1] ?? -Infinity);
      const fresh = data.t.flatMap((t, i) => (t > known ? [i] : []));
      const t = replace ? data.t : [...s.t, ...fresh.map((i) => data.t[i] ?? 0)];
      const hz = replace ? data.hz : [...s.hz, ...fresh.map((i) => data.hz[i] ?? 0)];
      const newest = t[t.length - 1] ?? 0;
      const cut = t.findIndex((x) => x >= newest - KEEP_S);
      return cut > 0 ? { t: t.slice(cut), hz: hz.slice(cut), dips: data.dips, lagS: data.lagS } : { t, hz, dips: data.dips, lagS: data.lagS };
    }),
}));

/**
 * Keep the shared series up to date. The first request takes the last hour; later ones take only what is new.
 * The server refreshes from the source about every 40 seconds, so polling faster gains nothing.
 */
export function useFrequencySync(enabled = true): Polled<FrequencyData> {
  return usePoll(
    (signal) => {
      const { t } = useFrequencyStore.getState();
      const since = t[t.length - 1] ?? null;
      return fetchFrequency(since, signal).then((data) => {
        useFrequencyStore.getState().ingest(data, since === null);
        return data;
      });
    },
    20_000,
    [],
    !enabled,
  );
}

/** Words for how far the frequency is from 50 Hz, in the bands grid operators use. */
export function describeFrequency(hz: number): { label: string; tone: "mint" | "ice" | "sodium" | "alarm" } {
  const off = Math.abs(hz - 50) * 1000;
  if (off <= 50) return { label: "Normal", tone: "mint" };
  if (off <= 150) return { label: hz < 50 ? "Low: reserves are working" : "High: reserves are working", tone: "sodium" };
  return { label: hz < 50 ? "Very low: emergency reserves" : "Very high: emergency reserves", tone: "alarm" };
}

/** Frequency at a moment between two one-second readings, so a moving trace never jumps. */
export function frequencyAt(t: readonly number[], hz: readonly number[], at: number): number | null {
  if (t.length === 0) return null;
  let lo = 0;
  let hi = t.length - 1;
  if (at <= (t[0] ?? 0)) return hz[0] ?? null;
  if (at >= (t[hi] ?? 0)) return hz[hi] ?? null;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if ((t[mid] ?? 0) <= at) lo = mid;
    else hi = mid;
  }
  const t0 = t[lo] ?? 0;
  const t1 = t[hi] ?? 0;
  const h0 = hz[lo] ?? 0;
  const h1 = hz[hi] ?? 0;
  return t1 === t0 ? h0 : h0 + ((h1 - h0) * (at - t0)) / (t1 - t0);
}

export const BORDER_CODE: Record<Border, string> = { Netherlands: "NL", France: "FR", Germany: "DE", "United Kingdom": "UK", Luxembourg: "LU" };

/** Megawatts as the reader would say them: "3.4 GW" above a thousand, "94 MW" below. */
export const powerWords = (mw: number): string => (Math.abs(mw) >= 1000 ? `${fmt.one(Math.abs(mw) / 1000)} GW` : `${fmt.int(Math.abs(mw))} MW`);

// ── Country and bidding zone ─────────────────────────────────────

const ANCHOR: Record<CountryCode, LatLon> = {
  it: { lat: 41.9, lon: 12.5 },
  be: { lat: 50.85, lon: 4.35 },
  fr: { lat: 48.85, lon: 2.35 },
  de: { lat: 52.5, lon: 13.4 },
  nl: { lat: 52.37, lon: 4.9 },
  es: { lat: 40.4, lon: -3.7 },
  pt: { lat: 38.7, lon: -9.14 },
  ch: { lat: 46.95, lon: 7.45 },
  at: { lat: 48.2, lon: 16.37 },
  pl: { lat: 52.23, lon: 21.0 },
};

const isCountry = (code: string): code is CountryCode => COUNTRIES.some((c) => c.code === code);

const nearest = (here: LatLon): CountryCode => {
  let best: CountryCode = "it";
  let bestM = Infinity;
  for (const c of COUNTRIES) {
    const m = distanceM(here, ANCHOR[c.code]);
    if (m < bestM) {
      best = c.code;
      bestM = m;
    }
  }
  return best;
};

const detected = new Map<string, CountryCode>();

/** The country the user is standing in (when it is one this screen covers), else the nearest one that is. */
export function useDetectedCountry(here: Here | null): CountryCode {
  const key = here ? `${here.lat.toFixed(1)},${here.lon.toFixed(1)}` : null;
  const [country, setCountry] = useState<CountryCode>(() => (key ? (detected.get(key) ?? (here ? nearest(here) : "it")) : "it"));
  useEffect(() => {
    if (!here || !key) return setCountry("it");
    const known = detected.get(key);
    if (known) return setCountry(known);
    setCountry(nearest(here));
    const controller = new AbortController();
    api<Place | null>(qs("/api/core/reverse", { lat: here.lat, lon: here.lon }), { signal: controller.signal })
      .then((place) => {
        const code = place?.countryCode?.toLowerCase();
        if (code && isCountry(code)) {
          detected.set(key, code);
          setCountry(code);
        }
      })
      .catch(() => undefined);
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return country;
}

/** The chosen country: the user's pick when there is one, otherwise where they are. */
export function useCountry(): { country: CountryCode; picked: boolean; setCountry: (c: CountryCode) => void } {
  const here = useLocation((s) => s.here);
  const auto = useDetectedCountry(here);
  const [picked, setPicked] = useStoredState<CountryCode | null>("power:country", null);
  const valid = picked && isCountry(picked) ? picked : null;
  return { country: valid ?? auto, picked: valid !== null, setCountry: setPicked };
}

/** Which Italian market zone a position falls in. Zones follow regions; this is a coarse outline, so the screen lets the user change it. */
export function zoneFor(country: CountryCode, here: LatLon | null): Zone {
  const zones = COUNTRIES.find((c) => c.code === country)?.zones ?? ["BE"];
  if (country !== "it") return zones[0] ?? "BE";
  if (!here) return "IT-Centre-South";
  const { lat, lon } = here;
  if (lon < 10 && lat > 38.8 && lat < 41.4) return "IT-Sardinia";
  if (lat < 38.4 && lon > 12.3 && lon < 15.7) return "IT-Sicily";
  if (lat >= 44) return "IT-North";
  if (lat >= 42.6 && lon < 14) return "IT-Centre-North";
  if (lat < 40 || (lat < 41.2 && lon >= 15.4) || (lat >= 41.2 && lat < 42 && lon >= 14.4)) return "IT-South";
  if (lat >= 41.2 && lon >= 15) return "IT-South";
  return "IT-Centre-South";
}

export const ZONE_LABEL: Record<Zone, string> = {
  "IT-North": "North",
  "IT-Centre-North": "Centre-North",
  "IT-Centre-South": "Centre-South",
  "IT-South": "South",
  "IT-Sicily": "Sicily",
  "IT-Sardinia": "Sardinia",
  BE: "Belgium",
  FR: "France",
  "DE-LU": "Germany and Luxembourg",
  NL: "Netherlands",
  ES: "Spain",
  PT: "Portugal",
  CH: "Switzerland",
  AT: "Austria",
  PL: "Poland",
};

// ── Reading a series at a moment ─────────────────────────────────

/** Index of the interval that contains `at`, or the nearest end. */
export function slotAt(t: readonly number[], at: number): number {
  if (t.length === 0) return -1;
  let lo = 0;
  let hi = t.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if ((t[mid] ?? 0) <= at) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

export interface Verdict {
  tone: "mint" | "sodium" | "alarm";
  /** Plain advice for running something heavy, like a dishwasher. */
  headline: string;
  /** What the next better time is, when there is one. */
  next: string | null;
  share: number;
}

const percent = (n: number): string => `${Math.round(n)} %`;

/** "" for today, " tomorrow" for tomorrow, otherwise " on Friday". */
export function dayWord(ms: number, nowMs: number): string {
  const day = (x: number): string => new Date(x).toLocaleDateString("en-CA");
  if (day(ms) === day(nowMs)) return "";
  return day(ms) === day(nowMs + 86_400_000) ? " tomorrow" : ` on ${new Date(ms).toLocaleDateString("en-GB", { weekday: "long" })}`;
}

/** The green/red advice for right now, from Energy-Charts' traffic-light forecast. */
export function greenVerdict(sig: GreenSignal, nowMs: number): Verdict | null {
  const now = nowMs / 1000;
  const i = slotAt(sig.t, now);
  const step = (sig.t[1] ?? 0) - (sig.t[0] ?? 0) || 900;
  if (i < 0 || now > (sig.t[sig.t.length - 1] ?? 0) + step) return null;
  const level = sig.signal[i] ?? 0;
  const share = sig.share[i] ?? 0;
  const when = (idx: number): string => `${fmt.clock((sig.t[idx] ?? 0) * 1000)}${dayWord((sig.t[idx] ?? 0) * 1000, nowMs)}`;

  if (level >= 2) {
    let end = i;
    while (end + 1 < sig.t.length && (sig.signal[end + 1] ?? 0) >= 2) end++;
    const stops = end + 1 < sig.t.length;
    return { tone: "mint", headline: `A good time to run the dishwasher: ${percent(share)} renewable${stops ? ` until ${when(end + 1)}` : " for the rest of the forecast"}.`, next: null, share };
  }

  // The next green stretch, or failing that the best hour ahead if it is clearly better than now.
  const green = sig.signal.findIndex((s, k) => k > i && s >= 2);
  let better = -1;
  if (green !== -1) better = green;
  else {
    let bestShare = share + 5;
    for (let k = i + 1; k < sig.t.length; k++) {
      if ((sig.share[k] ?? 0) > bestShare) {
        bestShare = sig.share[k] ?? 0;
        better = k;
      }
    }
  }
  const next = better === -1 ? null : `${green !== -1 ? "Green from" : "Greenest around"} ${when(better)}: ${percent(sig.share[better] ?? 0)} renewable.`;
  if (level === 1) return { tone: "sodium", headline: `An average time: ${percent(share)} renewable.`, next, share };
  return { tone: "alarm", headline: `${level < 0 ? "The grid is congested" : "Wait if you can"}: only ${percent(share)} of demand is renewable now.`, next, share };
}

export function priceAt(p: PricePoints, nowMs: number): { eurMwh: number; index: number } | null {
  const i = slotAt(p.t, nowMs / 1000);
  const v = p.eurMwh[i];
  return i < 0 || v === undefined ? null : { eurMwh: v, index: i };
}

/** Euro per megawatt hour as cents per kilowatt hour, the unit on a household bill. */
export const centsPerKwh = (eurMwh: number): string => `${(eurMwh / 10).toFixed(1)} c/kWh`;

// ── Words for the nuclear, gas and power-cut sections ─────────────

/** "1 Apr 2027", read in the time zone Rome and Brussels share. */
export function dateWords(unixS: number, withYear = true): string {
  return new Date(unixS * 1000).toLocaleDateString("en-GB", { timeZone: "Europe/Brussels", day: "numeric", month: "short", ...(withYear ? { year: "numeric" } : {}) });
}

/** The last day of a period that Elia ends at midnight: the 31st, not the 1st. */
export const endWords = (unixS: number, withYear = true): string => dateWords(unixS - 60, withYear);

/** "DOEL 4" as a reader would write it. */
export const unitName = (unit: string): string => unit.charAt(0) + unit.slice(1).toLowerCase();

/** The credit line ENTSOG's terms of use ask for: its name, the section, the date of extraction and its address. */
export function entsogCredit(section: string, now = new Date()): string {
  const date = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Brussels", day: "2-digit", month: "2-digit", year: "numeric" }).format(now).replaceAll("/", "-");
  return `ENTSOG TP ${section} ${date} https://transparency.entsog.eu/`;
}

/** Gas flow as "25.3 GWh/h"; below one, in MWh/h. */
export function gasWords(gwh: number): string {
  const v = Math.abs(gwh);
  if (v === 0) return "0 GWh/h";
  return v >= 1 ? `${v.toFixed(v >= 10 ? 1 : 2)} GWh/h` : `${fmt.int(v * 1000)} MWh/h`;
}
