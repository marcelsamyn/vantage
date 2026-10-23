import { fetchJson, z } from "../../server/kit";
import type { GasFlows, GasSite } from "./types";

/**
 * Gas entering Italy and Belgium, hour by hour, from the ENTSOG Transparency Platform (the EU network of gas
 * grid operators, set up under Regulation 715/2009). The platform gives no coordinates, so each site below
 * carries the position of the real terminal or border station, written by hand.
 *
 * A site adds up the legs that bring gas in and subtracts the legs that take it out. Belgium's operator Fluxys
 * publishes hourly flows only at Zeebrugge; at the Dutch border the Dutch operator publishes them, and gas
 * entering the Netherlands is gas leaving Belgium. Fluxys' French and German border stations publish no hourly
 * flow, so they are missing here.
 */

const URL_BASE = "https://transparency.entsog.eu/api/v1/operationalData";

interface SiteDef extends Pick<GasSite, "id" | "name" | "country" | "kind" | "origin" | "lat" | "lon" | "bearing"> {
  /** `operator + point + direction` keys of legs that bring gas into the country. */
  into: string[];
  /** Legs that take gas out of it. */
  out: string[];
}

const it = (point: string, direction: "entry" | "exit"): string => `IT-TSO-0001${point}${direction}`;
const be = (point: string, direction: "entry" | "exit"): string => `BE-TSO-0001${point}${direction}`;
const nl = (point: string, direction: "entry" | "exit"): string => `NL-TSO-0001${point}${direction}`;

export const GAS_SITES: SiteDef[] = [
  { id: "it-mazara", name: "Mazara del Vallo", country: "IT", kind: "pipeline", origin: "Algeria, through Tunisia and under the sea", lat: 37.651, lon: 12.589, bearing: 75, into: [it("ITP-00093", "entry")], out: [] },
  { id: "it-gela", name: "Gela", country: "IT", kind: "pipeline", origin: "Libya, under the sea", lat: 37.065, lon: 14.251, bearing: 25, into: [it("ITP-00074", "entry")], out: [] },
  { id: "it-melendugno", name: "Melendugno", country: "IT", kind: "pipeline", origin: "Azerbaijan, through Greece and Albania (TAP)", lat: 40.287, lon: 18.387, bearing: 255, into: [it("ITP-00008", "entry")], out: [it("ITP-00008", "exit")] },
  { id: "it-tarvisio", name: "Tarvisio", country: "IT", kind: "pipeline", origin: "Austria", lat: 46.505, lon: 13.576, bearing: 200, into: [it("ITP-00040", "entry")], out: [it("ITP-00040", "exit")] },
  { id: "it-gries", name: "Passo Gries", country: "IT", kind: "pipeline", origin: "Switzerland, over the Alps", lat: 46.442, lon: 8.342, bearing: 160, into: [it("ITP-00136", "entry")], out: [it("ITP-00136", "exit")] },
  { id: "it-gorizia", name: "Gorizia", country: "IT", kind: "pipeline", origin: "Slovenia", lat: 45.94, lon: 13.62, bearing: 250, into: [it("ITP-00049", "entry")], out: [it("ITP-00049", "exit")] },
  { id: "it-cavarzere", name: "Adriatic LNG, Porto Levante", country: "IT", kind: "lng", origin: "Tankers, offshore terminal", lat: 45.05, lon: 12.35, bearing: 270, into: [it("LNG-00015", "entry")], out: [] },
  { id: "it-ravenna", name: "Ravenna LNG", country: "IT", kind: "lng", origin: "Tankers, floating terminal", lat: 44.5, lon: 12.43, bearing: 270, into: [it("LNG-00082", "entry")], out: [] },
  { id: "it-panigaglia", name: "Panigaglia LNG", country: "IT", kind: "lng", origin: "Tankers, La Spezia", lat: 44.052, lon: 9.837, bearing: 20, into: [it("LNG-00019", "entry")], out: [] },
  { id: "it-livorno", name: "OLT Livorno LNG", country: "IT", kind: "lng", origin: "Tankers, floating terminal at sea", lat: 43.65, lon: 9.98, bearing: 90, into: [it("LNG-00004", "entry")], out: [] },
  { id: "it-piombino", name: "Piombino LNG", country: "IT", kind: "lng", origin: "Tankers, floating terminal", lat: 42.927, lon: 10.536, bearing: 80, into: [it("LNG-00069", "entry")], out: [] },

  { id: "be-zpt", name: "Zeebrugge, Norway pipelines", country: "BE", kind: "pipeline", origin: "Norway, under the North Sea", lat: 51.39, lon: 3.1, bearing: 135, into: [be("ITP-00106", "entry")], out: [be("ITP-00106", "exit")] },
  { id: "be-lng", name: "Zeebrugge LNG", country: "BE", kind: "lng", origin: "Tankers", lat: 51.33, lon: 3.2, bearing: 150, into: [be("LNG-00017", "entry")], out: [be("LNG-00017", "exit")] },
  { id: "be-izt", name: "Zeebrugge, UK link", country: "BE", kind: "pipeline", origin: "Great Britain, the Interconnector under the Channel", lat: 51.29, lon: 3.3, bearing: 100, into: [be("ITP-00061", "entry")], out: [be("ITP-00061", "exit")] },
  { id: "be-zelzate", name: "Zelzate", country: "BE", kind: "pipeline", origin: "The Netherlands", lat: 51.195, lon: 3.81, bearing: 200, into: [nl("ITP-00101", "exit")], out: [nl("ITP-00101", "entry")] },
  { id: "be-zandvliet", name: "Zandvliet", country: "BE", kind: "pipeline", origin: "The Netherlands", lat: 51.36, lon: 4.33, bearing: 180, into: [nl("ITP-00088", "exit")], out: [nl("ITP-00088", "entry")] },
  { id: "be-hilvarenbeek", name: "Hilvarenbeek", country: "BE", kind: "pipeline", origin: "The Netherlands", lat: 51.47, lon: 5.09, bearing: 180, into: [nl("ITP-00038", "exit")], out: [nl("ITP-00038", "entry")] },
  { id: "be-gravenvoeren", name: "'s Gravenvoeren", country: "BE", kind: "pipeline", origin: "The Netherlands", lat: 50.75, lon: 5.79, bearing: 180, into: [nl("ITP-00258", "exit")], out: [nl("ITP-00258", "entry")] },
];

const Row = z.object({
  operatorKey: z.string(),
  pointKey: z.string(),
  directionKey: z.string(),
  periodFrom: z.string(),
  // Hours that have not been reported yet arrive as an empty string.
  value: z.union([z.number(), z.literal("")]).nullable(),
});
const Reply = z.object({ operationalData: z.array(Row) });

export type GasRow = z.infer<typeof Row>;

const HOURS_KEPT = 48;
const KWH_PER_GWH = 1_000_000;

/** Add up one site's legs hour by hour. An hour counts once at least one leg has reported it. */
export function deriveSite(def: SiteDef, rows: readonly GasRow[]): GasSite | null {
  const sign = new Map<string, 1 | -1>([...def.into.map((k): [string, 1] => [k, 1]), ...def.out.map((k): [string, -1] => [k, -1])]);
  const perHour = new Map<number, number>();
  for (const r of rows) {
    const s = sign.get(`${r.operatorKey}${r.pointKey}${r.directionKey}`);
    if (s === undefined || r.value === null || r.value === "") continue;
    const t = Math.floor(Date.parse(r.periodFrom) / 1000);
    perHour.set(t, (perHour.get(t) ?? 0) + (s * r.value) / KWH_PER_GWH);
  }
  const series = [...perHour].sort((a, b) => a[0] - b[0]).slice(-HOURS_KEPT).map(([t, gwh]) => ({ t, gwh: Math.round(gwh * 100) / 100 }));
  const newest = series[series.length - 1];
  if (!newest) return null;
  const { id, name, country, kind, origin, lat, lon, bearing } = def;
  return { id, name, country, kind, origin, lat, lon, bearing, gwh: newest.gwh, at: newest.t, series };
}

const dateIn = (zone: string, ms: number): string => new Intl.DateTimeFormat("sv-SE", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(ms);

/** The raw hourly rows for every leg of every site: one request, cached by the caller. */
export async function fetchGasRows(): Promise<GasRow[]> {
  const legs = [...new Set(GAS_SITES.flatMap((s) => [...s.into, ...s.out]))];
  const now = Date.now();
  const params = new URLSearchParams({
    indicator: "Physical Flow",
    periodType: "hour",
    periodize: "0",
    limit: "-1",
    from: dateIn("Europe/Rome", now - 2 * 86_400_000),
    to: dateIn("Europe/Rome", now + 86_400_000),
    pointDirection: legs.join(","),
  });
  return (await fetchJson("ENTSOG Transparency Platform", `${URL_BASE}?${params}`, Reply, { timeoutMs: 30_000 })).operationalData;
}

export function buildGasFlows(rows: readonly GasRow[]): GasFlows {
  const sites = GAS_SITES.flatMap((def) => deriveSite(def, rows) ?? []);
  return { at: Math.max(0, ...sites.map((s) => s.at)), sites };
}
