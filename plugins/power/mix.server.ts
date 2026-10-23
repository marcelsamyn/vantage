import type { MixGroup, MixSeries, PowerMix, CountryCode } from "./types";

/** Turns Energy-Charts' per-fuel series into the groups the Power screen draws. */

export interface RawProduction {
  name: string;
  data: (number | null)[];
}

interface GroupInfo {
  id: MixGroup;
  label: string;
  renewable: boolean;
  /**
   * Lifecycle emissions in g CO2e per kWh: IPCC AR5 (Schlömer et al. 2014, Annex III) median values.
   * Null where the IPCC table has no entry; those groups are left out of the intensity estimate.
   */
  gPerKwh: number | null;
}

const GROUPS: Record<MixGroup, GroupInfo> = {
  solar: { id: "solar", label: "Solar", renewable: true, gPerKwh: 48 },
  wind: { id: "wind", label: "Wind", renewable: true, gPerKwh: 11 },
  hydro: { id: "hydro", label: "Hydro", renewable: true, gPerKwh: 24 },
  bio: { id: "bio", label: "Biomass", renewable: true, gPerKwh: 230 },
  geothermal: { id: "geothermal", label: "Geothermal", renewable: true, gPerKwh: 38 },
  nuclear: { id: "nuclear", label: "Nuclear", renewable: false, gPerKwh: 12 },
  gas: { id: "gas", label: "Gas", renewable: false, gPerKwh: 490 },
  coal: { id: "coal", label: "Coal", renewable: false, gPerKwh: 820 },
  oil: { id: "oil", label: "Oil", renewable: false, gPerKwh: null },
  storage: { id: "storage", label: "Batteries and pumped storage", renewable: false, gPerKwh: null },
  other: { id: "other", label: "Other and waste", renewable: false, gPerKwh: null },
};

/** Stacking order, bottom to top: steady sources first, weather-driven ones above. */
export const GROUP_ORDER: MixGroup[] = ["nuclear", "geothermal", "hydro", "bio", "wind", "solar", "gas", "coal", "oil", "storage", "other"];

function groupOf(name: string): MixGroup | null {
  if (name === "Solar") return "solar";
  if (name.startsWith("Wind")) return "wind";
  if (name === "Hydro Run-of-River" || name === "Hydro water reservoir") return "hydro";
  if (name === "Biomass") return "bio";
  if (name === "Geothermal") return "geothermal";
  if (name === "Nuclear") return "nuclear";
  if (name === "Fossil gas") return "gas";
  if (name.startsWith("Fossil brown") || name.startsWith("Fossil hard") || name.startsWith("Fossil coal")) return "coal";
  if (name.startsWith("Fossil oil") || name === "Fossil peat") return "oil";
  if (name === "Hydro pumped storage" || name === "Battery") return "storage";
  if (name === "Others" || name === "Waste") return "other";
  // "Load", "Residual load", the share series, trading and the storage-charging series are not generation.
  return null;
}

/** Find the series with this exact name, or an empty one so callers need no checks. */
function byName(raw: readonly RawProduction[], name: string, length: number): (number | null)[] {
  return raw.find((p) => p.name === name)?.data ?? new Array<number | null>(length).fill(null);
}

export function buildMix(country: CountryCode, t: number[], raw: readonly RawProduction[]): PowerMix {
  const length = t.length;
  const merged = new Map<MixGroup, number[]>();
  for (const p of raw) {
    const id = groupOf(p.name);
    if (!id) continue;
    const mw = merged.get(id) ?? new Array<number>(length).fill(0);
    p.data.forEach((v, i) => {
      mw[i] = (mw[i] ?? 0) + Math.max(0, v ?? 0);
    });
    merged.set(id, mw);
  }

  const series: MixSeries[] = GROUP_ORDER.filter((id) => merged.has(id) && (merged.get(id) ?? []).some((v) => v > 0)).map((id) => ({
    id,
    label: GROUPS[id].label,
    renewable: GROUPS[id].renewable,
    mw: merged.get(id) ?? [],
  }));

  const load = byName(raw, "Load", length);
  // Computed from generation, not taken from the source's "share of load": its load series swings by a factor of
  // four between quarter-hours while generation stays steady, and the share inherits every swing.
  const share = t.map((_, i) => {
    let renewable = 0;
    let total = 0;
    for (const s of series) {
      const mw = s.mw[i] ?? 0;
      total += mw;
      if (s.renewable) renewable += mw;
    }
    return total >= 1 ? Math.round((renewable / total) * 1000) / 10 : null;
  });

  const co2 = t.map((_, i) => {
    let grams = 0;
    let mwh = 0;
    for (const s of series) {
      const factor = GROUPS[s.id].gPerKwh;
      if (factor === null) continue;
      const mw = s.mw[i] ?? 0;
      grams += mw * factor;
      mwh += mw;
    }
    return mwh >= 1 ? Math.round(grams / mwh) : null;
  });

  // The newest interval is often half-reported (the sun has just set, or load has not arrived yet), so cut the tail.
  const solar = byName(raw, "Solar", length);
  const gas = byName(raw, "Fossil gas", length);
  const hasGas = raw.some((p) => p.name === "Fossil gas");
  // Generation never falls by a third in one interval; when it seems to, only part of it has been reported yet.
  const generation = t.map((_, i) => series.reduce((sum, s) => sum + (s.mw[i] ?? 0), 0));
  const partial = (i: number): boolean => {
    const now = generation[i] ?? 0;
    const before = generation[i - 1] ?? 0;
    return now < 1 || (before > 0 && now < before * 0.67);
  };
  let last = length - 1;
  while (last > 0 && (partial(last) || solar[last] == null || (hasGas && gas[last] == null))) last--;
  const keep = last + 1;

  return {
    country,
    t: t.slice(0, keep),
    stepS: length > 1 ? (t[1] ?? 0) - (t[0] ?? 0) : 900,
    series: series.map((s) => ({ ...s, mw: s.mw.slice(0, keep) })),
    load: load.slice(0, keep),
    renewableShare: share.slice(0, keep),
    co2: co2.slice(0, keep),
  };
}
