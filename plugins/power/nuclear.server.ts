import { fetchJson, HttpError, z } from "../../server/kit";
import type { NuclearFleet, NuclearOutage, Reactor } from "./types";

/**
 * Belgium's nuclear reactors from Elia Open Data (Elia Open Data Licence): the current list of nuclear units
 * (ods179) and every outage notice for them (ods202). Elia publishes what each unit CAN deliver, not what it
 * delivers, so a unit with no notice is "available", which is not the same as "generating".
 */

const BASE = "https://opendata.elia.be/api/explore/v2.1/catalog/datasets";

const NuclearUnits = z.object({ results: z.array(z.object({ date: z.string(), technicalunit: z.string(), technicalpmax: z.number() })) });

const Notice = z.object({
  productionunitname: z.string(),
  technicalpmax: z.number(),
  availablepowerduringoutage: z.number(),
  startdatetime: z.string(),
  enddatetime: z.string(),
  outagereason: z.string(),
  type: z.string(),
  lastupdated: z.string(),
});
const Notices = z.object({ results: z.array(Notice) });
const UnitNames = z.object({ results: z.array(z.object({ productionunitname: z.string() })) });

type NoticeRow = z.infer<typeof Notice>;

const DAY_S = 86_400;
/** A notice must take away this much of the capacity to count as an outage; stretch-out curves and start-up ramps trim only a few percent. */
const OUTAGE_SHARE = 0.6;
/** Elia ends a standing "shut down by law" notice in the year 2099. Anything past this year has no real end date. */
const PLACEHOLDER_YEAR = 2090;
/** Notices a day apart describe one outage that Elia filed twice. */
const MERGE_GAP_S = 2 * DAY_S;

const NUCLEAR_FILTER = "(productionunitname like 'DOEL%' or productionunitname like 'TIHANGE%')";

const unix = (iso: string): number => Math.floor(Date.parse(iso) / 1000);

const toOutage = (n: NoticeRow): NuclearOutage => ({
  from: unix(n.startdatetime),
  until: new Date(n.enddatetime).getUTCFullYear() >= PLACEHOLDER_YEAR ? null : unix(n.enddatetime),
  availableMw: Math.round(n.availablepowerduringoutage),
  type: n.type === "Forced" ? "Forced" : "Planned",
  reason: n.outagereason,
});

/** Two or three notices for one stretch become one. The most informative reason wins: "Other" says nothing. */
function mergeOutages(outages: NuclearOutage[]): NuclearOutage[] {
  const merged: NuclearOutage[] = [];
  for (const o of [...outages].sort((a, b) => a.from - b.from)) {
    const last = merged[merged.length - 1];
    if (last && (last.until === null || o.from <= last.until + MERGE_GAP_S)) {
      last.until = last.until === null || o.until === null ? null : Math.max(last.until, o.until);
      last.availableMw = Math.min(last.availableMw, o.availableMw);
      if (last.reason === "Other" || (o.reason !== "Other" && o.type === "Forced")) last.reason = o.reason;
      if (o.type === "Forced") last.type = "Forced";
      continue;
    }
    merged.push({ ...o });
  }
  return merged;
}

function stateOf(capacityMw: number, availableMw: number): Reactor["status"] {
  if (availableMw <= 0) return "offline";
  return availableMw < capacityMw * 0.97 ? "reduced" : "available";
}

export interface NuclearInput {
  units: { unit: string; capacityMw: number }[];
  notices: NoticeRow[];
  everListed: string[];
}

/** Turn Elia's raw rows into one record per reactor. Pure, so the odd cases are testable. */
export function buildFleet({ units, notices, everListed }: NuclearInput, now = Date.now() / 1000): NuclearFleet {
  const reactors: Reactor[] = units.map(({ unit, capacityMw }) => {
    const mine = notices.filter((n) => n.productionunitname === unit);
    const covering = mine.map(toOutage).filter((o) => o.from <= now && (o.until === null || o.until >= now));
    const availableMw = covering.length === 0 ? capacityMw : Math.min(capacityMw, ...covering.map((o) => o.availableMw));
    const significant = mine.filter((n) => n.availablepowerduringoutage < n.technicalpmax * OUTAGE_SHARE).map(toOutage);
    const outages = mergeOutages(significant).filter((o) => o.until === null || o.until >= now);
    const current = outages.find((o) => o.from <= now && (o.until === null || o.until >= now)) ?? null;
    return {
      unit,
      site: unit.startsWith("TIHANGE") ? "Tihange" : "Doel",
      capacityMw,
      availableMw,
      status: stateOf(capacityMw, availableMw),
      current,
      outages,
    };
  });
  const listed = new Set(units.map((u) => u.unit));
  // Tihange 1 is filed as two halves, "1N" and "1S".
  const reactorOf = (name: string): string => name.replace(/(\d)[NS]$/, "$1");
  const retired = [...new Set(everListed.map(reactorOf))].filter((name) => !listed.has(name) && /^(DOEL|TIHANGE)\s\d$/.test(name)).sort();
  return { at: Math.max(0, ...notices.map((n) => unix(n.lastupdated))), reactors: reactors.sort((a, b) => a.unit.localeCompare(b.unit)), retired };
}

export async function fetchNuclearInput(): Promise<NuclearInput> {
  const query = (dataset: string, params: Record<string, string>): string => `${BASE}/${dataset}/records?${new URLSearchParams(params)}`;
  const since = new Date(Date.now() - 2 * DAY_S * 1000).toISOString().slice(0, 19);

  const [listed, notices, names] = await Promise.all([
    fetchJson("Elia nuclear units", query("ods179", { where: "fueltypepublication='Nuclear'", order_by: "date desc", limit: "20", select: "date,technicalunit,technicalpmax" }), NuclearUnits),
    fetchJson(
      "Elia outage notices",
      query("ods202", { where: `${NUCLEAR_FILTER} and outagestatus='Active' and enddatetime>=date'${since}'`, order_by: "startdatetime", limit: "100", select: "productionunitname,technicalpmax,availablepowerduringoutage,startdatetime,enddatetime,outagereason,type,lastupdated" }),
      Notices,
    ),
    fetchJson("Elia outage notices", query("ods202", { where: NUCLEAR_FILTER, group_by: "productionunitname", limit: "50" }), UnitNames),
  ]);

  const newest = listed.results[0]?.date;
  if (!newest) throw new HttpError(502, "upstream_empty", "Elia lists no nuclear units");
  const units = listed.results.filter((r) => r.date === newest).map((r) => ({ unit: r.technicalunit, capacityMw: Math.round(r.technicalpmax) }));
  return { units, notices: notices.results, everListed: names.results.map((r) => r.productionunitname) };
}
