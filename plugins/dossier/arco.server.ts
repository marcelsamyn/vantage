import { HttpError, diskMemo, fetchJson, z } from "../../server/kit";
import { distanceM, type LatLon } from "../../shared/geo";
import { LOOKUP_MARGIN_M, cellAround, type Cell } from "./area.server";
import { creditedAuthor } from "./people.server";
import type { HeritageEntry } from "./types";

/**
 * Italy's national heritage catalogue (ArCo, Ministero della Cultura) through its public SPARQL endpoint.
 * The query is a fixed template: the only values that vary are six numbers, printed with fixed decimals.
 */

const ENDPOINT = "https://dati.beniculturali.it/sparql";
const SOURCE = "ArCo SPARQL (Catalogo generale dei beni culturali)";
const CACHE_MS = 24 * 3_600_000;
const MAX_ROWS = 600;

const Bind = z.object({ value: z.string() });
const ArcoResponse = z.object({
  results: z.object({
    bindings: z.array(
      z.object({
        s: Bind,
        title: Bind,
        la: Bind,
        lo: Bind,
        kind: Bind.optional(),
        when: Bind.optional(),
        by: Bind.optional(),
        school: Bind.optional(),
      }),
    ),
  }),
});

/** Rows are kept on disk for a day, so what is read back is checked against the fields the code expects. */
const StoredArcoRows = z.array(
  z.object({
    id: z.string(),
    title: z.string(),
    lat: z.number(),
    lon: z.number(),
    kind: z.string().nullable(),
    period: z.string().nullable(),
    author: z.string().nullable(),
  }),
);

interface ArcoRow {
  id: string;
  title: string;
  lat: number;
  lon: number;
  kind: string | null;
  period: string | null;
  author: string | null;
}

function queryFor(cell: Cell): string {
  const n = (v: number): string => {
    if (!Number.isFinite(v)) throw new HttpError(400, "bad_query", "Coordinates must be numbers");
    return v.toFixed(6);
  };
  return `PREFIX arco: <https://w3id.org/arco/ontology/arco/>
PREFIX loc: <https://w3id.org/arco/ontology/location/>
PREFIX clv: <https://w3id.org/italia/onto/CLV/>
PREFIX cd: <https://w3id.org/arco/ontology/context-description/>
PREFIX dd: <https://w3id.org/arco/ontology/denotative-description/>
PREFIX ti: <https://w3id.org/italia/onto/TI/>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>
SELECT ?s (SAMPLE(?label) AS ?title) (SAMPLE(?lat) AS ?la) (SAMPLE(?lon) AS ?lo) (SAMPLE(?type) AS ?kind) (SAMPLE(?period) AS ?when) (SAMPLE(?author) AS ?by) (SAMPLE(?scope) AS ?school) WHERE {
  ?s a arco:ArchitecturalOrLandscapeHeritage ; rdfs:label ?label ; clv:hasGeometry ?g .
  ?g loc:hasCoordinates ?c .
  ?c loc:lat ?lat ; loc:long ?lon .
  FILTER(lang(?label) = "it" && xsd:decimal(?lat) > ${n(cell.south)} && xsd:decimal(?lat) < ${n(cell.north)} && xsd:decimal(?lon) > ${n(cell.west)} && xsd:decimal(?lon) < ${n(cell.east)})
  OPTIONAL { ?s dd:hasCulturalPropertyType/rdfs:label ?type }
  OPTIONAL { ?s cd:hasDating/cd:hasDatingEvent/ti:atTime/rdfs:label ?period }
  OPTIONAL { ?s cd:hasAuthorshipAttribution/cd:hasAttributedAuthor/rdfs:label ?author }
  OPTIONAL { ?s cd:hasAuthorshipAttribution/cd:hasCulturalScope/rdfs:label ?scope }
} GROUP BY ?s LIMIT ${MAX_ROWS}`;
}

/** "[Casa in Via della Minerva, 1(P),2] (casa, privata) - Roma (RM) " becomes "Casa in Via della Minerva, 1, 2". */
function cleanTitle(label: string): string {
  const inBrackets = /^\s*\[([^\]]+)\]/.exec(label)?.[1];
  const base = inBrackets ?? label.split(" - ")[0] ?? label;
  return base.replace(/\(P\)/g, "").replace(/\s+/g, " ").trim();
}

/** Centuries are written in Roman numerals ("XV-XVIII"); the catalogue convention for them is "sec.". */
function cleanPeriod(label: string): string {
  const text = label.trim();
  return /\b[IVXL]+\b/.test(text) && !/\d/.test(text) ? `sec. ${text}` : text;
}

async function rowsIn(cell: Cell): Promise<ArcoRow[]> {
  return diskMemo(`dossier-arco-${cell.key}`, CACHE_MS, async () => {
    const url = new URL(ENDPOINT);
    url.searchParams.set("query", queryFor(cell));
    url.searchParams.set("format", "application/sparql-results+json");
    const data = await fetchJson(SOURCE, url, ArcoResponse, { timeoutMs: 40_000 });
    return data.results.bindings.flatMap((b): ArcoRow[] => {
      const lat = Number(b.la.value);
      const lon = Number(b.lo.value);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return [];
      return [
        {
          id: b.s.value.split("/").pop() ?? b.s.value,
          title: cleanTitle(b.title.value),
          lat,
          lon,
          kind: b.kind?.value.trim() || null,
          period: b.when ? cleanPeriod(b.when.value) : null,
          // The register names the designer or workshop; that name is shown as credited.
          author: creditedAuthor(b.by?.value, b.school?.value),
        },
      ];
    });
  }, StoredArcoRows);
}

/** Catalogued buildings and landscapes within `radiusM` of the point, nearest first. */
export async function arcoNear(at: LatLon, radiusM: number, limit: number): Promise<HeritageEntry[]> {
  const rows = await rowsIn(cellAround(at, Math.max(radiusM, LOOKUP_MARGIN_M)));
  return rows
    .map((r) => ({ r, d: distanceM(at, r) }))
    .filter(({ d }) => d <= radiusM)
    .sort((a, b) => a.d - b.d)
    .slice(0, limit)
    .map(({ r, d }) => ({
      id: r.id,
      title: r.title,
      kind: r.kind,
      period: r.period,
      author: r.author,
      note: null,
      distanceM: Math.round(d),
      url: `https://catalogo.beniculturali.it/detail/ArchitecturalOrLandscapeHeritage/${r.id}`,
    }));
}

export const ARCO_SOURCE = "Catalogo generale dei beni culturali (ArCo)";
