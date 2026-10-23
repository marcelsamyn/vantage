import { fetchJson, HttpError, z } from "../../server/kit";
import type { BelgiumGrid, Border, BorderFlow, Imbalance, LineMap, TieLine } from "./types";

/** Elia (the Belgian grid operator) Open Data, Opendatasoft API v2.1. Licence: Elia Open Data Licence. */

const BASE = "https://opendata.elia.be/api/explore/v2.1/catalog/datasets";

const BORDERS: Record<string, Border> = {
  France: "France",
  Germany: "Germany",
  Netherlands: "Netherlands",
  Luxembourg: "Luxembourg",
  "United Kingdom": "United Kingdom",
};

const unix = (iso: string): number => Math.floor(Date.parse(iso) / 1000);

/** Opendatasoft filters take `date'…'` literals in UTC. */
const dateLiteral = (ms: number): string => `date'${new Date(ms).toISOString().slice(0, 19)}'`;

function url(dataset: string, params: Record<string, string>): string {
  return `${BASE}/${dataset}/records?${new URLSearchParams(params)}`;
}

// ── Physical flows and imbalance ──────────────────────────────────

const FlowRecords = z.object({
  results: z.array(z.object({ datetime: z.string(), controlarea: z.string(), physicalflowatborder: z.number().nullable() })),
});

const ImbalanceRecords = z.object({
  results: z.array(z.object({ datetime: z.string(), systemimbalance: z.number().nullable(), ace: z.number().nullable() })),
});

const FLOW_HISTORY_MS = 3 * 3_600_000;
const IMBALANCE_MINUTES = 60;

async function fetchFlows(): Promise<BorderFlow[]> {
  const rows = await fetchJson(
    "Elia physical flows",
    url("ods160", { limit: "100", order_by: "datetime desc", where: `datetime>=${dateLiteral(Date.now() - FLOW_HISTORY_MS)}`, select: "datetime,controlarea,physicalflowatborder" }),
    FlowRecords,
  );
  const byBorder = new Map<Border, { t: number; mw: number }[]>();
  for (const r of rows.results) {
    const border = BORDERS[r.controlarea];
    if (!border || r.physicalflowatborder === null) continue;
    const list = byBorder.get(border) ?? [];
    list.push({ t: unix(r.datetime), mw: Math.round(r.physicalflowatborder) });
    byBorder.set(border, list);
  }
  const flows: BorderFlow[] = [];
  for (const [border, list] of byBorder) {
    const oldestFirst = list.sort((a, b) => a.t - b.t);
    const newest = oldestFirst.at(-1);
    if (newest) flows.push({ border, mw: newest.mw, at: newest.t, history: oldestFirst });
  }
  return flows;
}

async function fetchImbalance(): Promise<Imbalance | null> {
  const rows = await fetchJson(
    "Elia system imbalance",
    url("ods169", { limit: String(IMBALANCE_MINUTES), order_by: "datetime desc", select: "datetime,systemimbalance,ace" }),
    ImbalanceRecords,
  );
  const series = rows.results
    .filter((r): r is typeof r & { systemimbalance: number } => r.systemimbalance !== null)
    .map((r) => ({ t: unix(r.datetime), mw: Math.round(r.systemimbalance) }))
    .sort((a, b) => a.t - b.t);
  const newest = rows.results.find((r) => r.systemimbalance !== null);
  if (!newest || newest.systemimbalance === null) return null;
  return { at: unix(newest.datetime), mw: Math.round(newest.systemimbalance), ace: newest.ace === null ? null : Math.round(newest.ace), series };
}

export async function fetchBelgium(): Promise<BelgiumGrid> {
  const [flows, imbalance] = await Promise.all([fetchFlows(), fetchImbalance()]);
  if (flows.length === 0 && !imbalance) throw new HttpError(502, "upstream_empty", "Elia Open Data returned no readings for the last three hours");
  return { flows, imbalance };
}

// ── 380 kV lines ──────────────────────────────────────────────────

const LineRecords = z.object({
  results: z.array(
    z.object({
      datetime: z.string(),
      assetid: z.string(),
      assetname: z.string(),
      assettype: z.string(),
      loading: z.number().nullable(),
      assetgeographiclocation: z.object({ geometry: z.object({ type: z.literal("LineString"), coordinates: z.array(z.tuple([z.number(), z.number()])) }) }),
    }),
  ),
});

const NewestLine = z.object({ results: z.array(z.object({ datetime: z.string() })) });

/** Which neighbour a cross-border line ends in, by the name of its foreign substation or converter. */
function borderOf(lineName: string): Border | null {
  if (/ALEGRO/.test(lineName)) return "Germany";
  if (/NEMO/.test(lineName)) return "United Kingdom";
  if (/MAASBRACHT|RILLAND/.test(lineName)) return "Netherlands";
  if (/AVELIN|MASTAING|LONNY/.test(lineName)) return "France";
  return null;
}

const distance2 = (a: [number, number], b: [number, number]): number => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;

export async function fetchLineMap(): Promise<LineMap> {
  // Loading readings are published about a day late, so ask for the newest timestamp first.
  const newest = (await fetchJson("Elia 380 kV lines", url("ods124", { limit: "1", order_by: "datetime desc", select: "datetime" }), NewestLine)).results[0];
  if (!newest) throw new HttpError(502, "upstream_empty", "Elia Open Data lists no 380 kV line readings");
  const rows = await fetchJson(
    "Elia 380 kV lines",
    url("ods124", { limit: "100", where: `datetime=${dateLiteral(Date.parse(newest.datetime))}`, select: "datetime,assetid,assetname,assettype,loading,assetgeographiclocation" }),
    LineRecords,
  );

  const internal = rows.results.filter((r) => r.assettype !== "Tieline").map((r) => ({ id: r.assetid, name: r.assetname, loading: r.loading, coords: r.assetgeographiclocation.geometry.coordinates }));
  // The foreign end of a tie line is the end farthest from the middle of Belgium's own grid.
  const ends = internal.flatMap((l) => [l.coords[0], l.coords[l.coords.length - 1]]).filter((c): c is [number, number] => c !== undefined);
  const centre: [number, number] = [ends.reduce((s, c) => s + c[0], 0) / Math.max(1, ends.length), ends.reduce((s, c) => s + c[1], 0) / Math.max(1, ends.length)];

  const ties: TieLine[] = [];
  for (const r of rows.results.filter((x) => x.assettype === "Tieline")) {
    const border = borderOf(r.assetname);
    const coords = r.assetgeographiclocation.geometry.coordinates;
    const first = coords[0];
    const last = coords[coords.length - 1];
    if (!border || !first || !last) continue;
    ties.push({ id: r.assetid, name: r.assetname, border, loading: r.loading, coords: distance2(first, centre) > distance2(last, centre) ? [...coords].reverse() : coords });
  }
  return { at: unix(newest.datetime), internal, ties };
}
