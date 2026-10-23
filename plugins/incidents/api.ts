import { defineSource, fetchJson, HttpError, json, lat, lon, memo, parseQuery, parseUpstream, webUrl, z } from "../../server/kit";
import { zoned } from "../pulse/time.server";
import { inView, overlapsCoverage, SOURCES } from "./model";
import type { Incident, IncidentBox, IncidentSource, Incidents } from "./types";

const Position = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]);
const Point = z.object({ type: z.literal("Point"), coordinates: Position });
const Ring = z.array(Position).min(4);
const Area = z.union([z.object({ type: z.literal("Polygon"), coordinates: z.array(Ring).min(1) }), z.object({ type: z.literal("MultiPolygon"), coordinates: z.array(z.array(Ring).min(1)).min(1) })]);
type Geometry = GeoJSON.Point | GeoJSON.Polygon | GeoJSON.MultiPolygon | { type: "GeometryCollection"; geometries: Geometry[] };
const Geometry: z.ZodType<Geometry> = z.lazy(() => z.union([Point, Area, z.object({ type: z.literal("GeometryCollection"), geometries: z.array(Geometry) })]));
const Epoch = z.number().finite().min(Date.UTC(2000, 0, 1)).max(Date.UTC(2200, 0, 1));
const Count = z.number().int().nonnegative();
const Text = z.string().nullable().optional();
const Portuguese = z.object({ type: z.literal("FeatureCollection"), features: z.array(z.object({ geometry: Point.nullable(), properties: z.object({ Numero: z.string(), ID: z.string().optional(), ID_oc: z.number().optional(), Natureza: z.string(), EstadoOcorrencia: z.string(), EstadoAgrupado: Text, DataOcorrencia: Epoch, DataDosDados: Epoch, Concelho: Text, Freguesia: Text, Localidade: Text, Endereco: Text, Operacionais: Count, MeiosTerrestres: Count, MeiosAereos: Count, QuantEntidades: Count.optional(), Latitude: z.number().min(-90).max(90), Longitude: z.number().min(-180).max(180) }) })) });
const LocalDate = z.string().regex(/^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}:\d{2}$/);
const Victorian = z.object({ results: z.array(z.object({ incidentNo: z.union([z.string(), z.number()]), latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180), lastUpdatedDt: Epoch, originDateTime: LocalDate, lastUpdateDateTime: LocalDate, incidentType: z.string(), incidentStatus: z.string(), incidentLocation: z.string(), name: z.string(), category1: z.string(), category2: z.string(), territory: Text, agency: Text, incidentSize: Text, municipality: Text, resourceCount: Count })) });
const NewSouthWales = z.object({ type: z.literal("FeatureCollection"), features: z.array(z.object({ geometry: Geometry.nullable(), properties: z.object({ title: z.string(), guid: z.string(), link: z.string(), category: z.string(), description: z.string(), pubDate: z.string() }) })) });
const SeattleCoordinate = z.union([z.number(), z.string().regex(/^-?\d+(?:\.\d+)?$/).transform(Number)]);
const Seattle = z.array(z.object({ incident_number: z.string(), type: z.string(), address: z.string(), datetime: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?$/), latitude: SeattleCoordinate.pipe(z.number().min(-90).max(90)).optional(), longitude: SeattleCoordinate.pipe(z.number().min(-180).max(180)).optional(), report_location: Point.optional() }));

const localFormatters = new Map<string, Intl.DateTimeFormat>();

function localTime(text: string, zone: string): number {
  const date = zoned(text, zone);
  if (date === null || !Number.isFinite(date)) throw new HttpError(502, "incident_date", `Incident feed has an invalid date: ${text}`);
  const expected = text.slice(0, 19).replaceAll("/", "-").replace(" ", "T");
  let formatter = localFormatters.get(zone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
    localFormatters.set(zone, formatter);
  }
  const parts = formatter.formatToParts(date);
  const part = (type: string): string => parts.find((p) => p.type === type)?.value ?? "";
  const actual = `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}:${part("second")}`;
  if (actual !== expected) throw new HttpError(502, "incident_date", `Incident feed has an invalid or ambiguous local date: ${text}`);
  return date;
}
function australianTime(text: string, zone: string): number {
  const [date = "", clock = ""] = text.split(" ");
  const [day, month, year] = date.split("/");
  return localTime(`${year}-${month}-${day}T${clock}`, zone);
}
function rows(values: [string, string | number | null | undefined][]): [string, string][] {
  return values.flatMap(([key, value]) => value === null || value === undefined || value === "" ? [] : [[key, String(value)] satisfies [string, string]]);
}
function base(source: IncidentSource, number: string): Pick<Incident, "source" | "id" | "number" | "areas" | "href" | "match"> {
  return { source, number, id: `${source}:${number}`, areas: [], href: SOURCES[source].href, match: [`${source}:${number}`] };
}
function geometries(geometry: Geometry | null): (GeoJSON.Point | GeoJSON.Polygon | GeoJSON.MultiPolygon)[] {
  if (!geometry) return [];
  return geometry.type === "GeometryCollection" ? geometry.geometries.flatMap(geometries) : [geometry];
}
function descriptionRows(html: string): [string, string][] {
  return html.split(/<br\s*\/?\s*>/i).flatMap((line) => {
    const text = line.replace(/<[^>]*>/g, "").replaceAll("&amp;", "&").replaceAll("&nbsp;", " ").trim();
    const colon = text.indexOf(":");
    return colon > 0 ? [[text.slice(0, colon), text.slice(colon + 1).trim()] satisfies [string, string]] : [];
  });
}
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function nswTime(text: string | undefined): number | null {
  if (!text) return null;
  const m = /^(\d{1,2}) ([A-Z][a-z]{2}) (\d{4}) (\d{2}):(\d{2})$/.exec(text);
  const month = MONTHS.indexOf(m?.[2] ?? "") + 1;
  if (!m || !month) throw new HttpError(502, "incident_date", `NSW RFS has an invalid updated date: ${text}`);
  return localTime(`${m[3]}-${String(month).padStart(2, "0")}-${m[1]?.padStart(2, "0")}T${m[4]}:${m[5]}:00`, "Australia/Sydney");
}

/** The same boundary parser handles live responses and recorded official fixtures. */
export function parseIncidents(source: IncidentSource, raw: unknown, now = Date.now()): Incident[] {
  switch (source) {
    case "portugal": return parseUpstream("ANEPC", Portuguese, raw).features.map(({ properties: p, geometry }): Incident => ({ ...base(source, p.Numero), match: [`portugal:${p.Numero}`, ...(p.ID ? [`anepc-id:${p.ID}` as const] : []), ...(p.ID_oc ? [`anepc-feature:${p.ID_oc}` as const] : [])], title: p.Natureza, category: p.Natureza, status: p.EstadoOcorrencia, location: [p.Endereco, p.Localidade, p.Freguesia, p.Concelho].filter(Boolean).join(" · "), lat: geometry?.coordinates[1] ?? p.Latitude, lon: geometry?.coordinates[0] ?? p.Longitude, startedAt: p.DataOcorrencia, updatedAt: p.DataDosDados, alert: false, rows: rows([["Status group", p.EstadoAgrupado], ["Personnel", p.Operacionais], ["Ground resources", p.MeiosTerrestres], ["Air resources", p.MeiosAereos], ["Agencies", p.QuantEntidades], ["Municipality", p.Concelho], ["Parish", p.Freguesia], ["Locality", p.Localidade], ["Address", p.Endereco], ["Source ID", p.ID], ["Feature ID", p.ID_oc]]) }));
    case "victoria": return parseUpstream("VicEmergency", Victorian, raw).results.map((p): Incident => ({ ...base(source, String(p.incidentNo)), title: `${p.category1} · ${p.name}`, category: `${p.category1} · ${p.category2}`, status: p.incidentStatus, location: [p.name, p.incidentLocation, p.municipality].filter(Boolean).join(" · "), lat: p.latitude, lon: p.longitude, startedAt: australianTime(p.originDateTime, "Australia/Melbourne"), updatedAt: p.lastUpdatedDt, alert: p.incidentStatus === "Not Yet Under Control", rows: rows([["Type", p.incidentType], ["Resources", p.resourceCount], ["Agency", p.agency], ["Territory", p.territory], ["Size", p.incidentSize], ["Municipality", p.municipality]]) }));
    case "nsw": return parseUpstream("NSW Rural Fire Service", NewSouthWales, raw).features.flatMap(({ properties: p, geometry }): Incident[] => {
      const shapes = geometries(geometry);
      const point = shapes.find((s): s is GeoJSON.Point => s.type === "Point");
      if (!point) return [];
      const details = descriptionRows(p.description);
      const detail = new Map(details);
      const updatedAt = nswTime(detail.get("UPDATED"));
      return [{ ...base(source, p.guid), title: p.title, category: detail.get("TYPE") ?? p.category, status: detail.get("STATUS") ?? p.category, location: detail.get("LOCATION") ?? p.title, lat: point.coordinates[1] ?? 0, lon: point.coordinates[0] ?? 0, startedAt: null, updatedAt, alert: p.category === "Emergency Warning" || p.category === "Watch and Act", areas: shapes.filter((s): s is GeoJSON.Polygon | GeoJSON.MultiPolygon => s.type !== "Point"), rows: details, href: webUrl(p.link) ?? SOURCES[source].href }];
    });
    case "seattle": return parseUpstream("Seattle Fire 911", Seattle, raw).flatMap((p): Incident[] => {
      const startedAt = localTime(p.datetime, "America/Los_Angeles");
      if (startedAt < now - 48 * 3600000 || startedAt > now + 60000) return [];
      // Seattle publishes a call before it is geocoded, leaving out every position field; the map cannot place it yet.
      const lat = p.latitude ?? p.report_location?.coordinates[1];
      const lon = p.longitude ?? p.report_location?.coordinates[0];
      if (lat === undefined || lon === undefined) return [];
      return [{ ...base(source, p.incident_number), title: p.type, category: p.type, status: "Dispatch record · closure not published", location: p.address, lat, lon, startedAt, updatedAt: null, alert: false, rows: [] }];
    });
  }
}

function sourceUrl(source: IncidentSource, now: number): string {
  switch (source) {
    case "portugal": return "https://services-eu1.arcgis.com/VlrHb7fn5ewYhX6y/arcgis/rest/services/OcorrenciasSite/FeatureServer/0/query?where=1%3D1&outFields=*&returnGeometry=true&outSR=4326&f=geojson";
    case "victoria": return "https://data.emergency.vic.gov.au/Show?pageId=getIncidentJSON";
    case "nsw": return "https://www.rfs.nsw.gov.au/feeds/majorIncidents.json";
    case "seattle": {
      const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(now - 48 * 3600000);
      const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? "";
      const cutoff = `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:${get("second")}`;
      return `https://data.seattle.gov/resource/kzjm-xkqj.json?${new URLSearchParams({ "$where": `datetime >= '${cutoff}'`, "$order": "datetime DESC", "$limit": "5000" })}`;
    }
  }
}
const Query = z.object({ source: z.enum(["portugal", "victoria", "nsw", "seattle"]), west: lon, east: lon, south: lat, north: lat }).refine((v) => v.south <= v.north, { message: "south must not exceed north" });
export async function incidentsInBox(source: IncidentSource, box: IncidentBox, now = Date.now()): Promise<Incidents> {
  if (!overlapsCoverage(source, box)) return { source, fetchedAt: now, incidents: [] };
  const snapshot = await memo(`incidents:${source}`, SOURCES[source].refreshMs, async (): Promise<Incidents> => {
    const raw = await fetchJson(SOURCES[source].title, sourceUrl(source, now), z.unknown());
    const incidents = parseIncidents(source, raw, now);
    return { source, fetchedAt: Date.now(), incidents };
  }, SOURCES[source].refreshMs);
  return { ...snapshot, incidents: snapshot.incidents.filter((item) => inView(item, box) && (source !== "seattle" || (item.startedAt ?? 0) >= now - 48 * 3600000)) };
}
export default defineSource({ routes: { "GET /": async (req) => {
  const { source, ...box } = parseQuery(req, Query);
  return json(await incidentsInBox(source, box));
} } });
