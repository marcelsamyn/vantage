import type { Incident, IncidentBox, IncidentSource } from "./types";

export const SOURCES = {
  portugal: { title: "Portugal · ANEPC", box: { west: -9.6, east: -6.1, south: 36.8, north: 42.2 }, refreshMs: 120_000, href: "https://prociv.gov.pt/pt/ocorrencias/", credit: "ANEPC · CC BY 4.0", coverage: "Mainland Portugal. Open operational incidents, including long-running responses." },
  victoria: { title: "Victoria · VicEmergency", box: { west: 140.9, east: 150.1, south: -39.3, north: -33.9 }, refreshMs: 120_000, href: "https://emergency.vic.gov.au/respond/", credit: "VicEmergency · Country Fire Authority", coverage: "Victoria, Australia. Incident reports and responding resources." },
  nsw: { title: "New South Wales · RFS", box: { west: 141, east: 153.7, south: -37.6, north: -28.1 }, refreshMs: 1_800_000, href: "https://www.rfs.nsw.gov.au/fire-information/fires-near-me", credit: "© State of New South Wales (NSW Rural Fire Service). For current information go to www.rfs.nsw.gov.au. CC BY 4.0.", coverage: "New South Wales, Australia. RFS incidents; fire outlines when published. Some positions are local government area centres." },
  seattle: { title: "Seattle · Fire 911", box: { west: -122.46, east: -122.22, south: 47.48, north: 47.75 }, refreshMs: 300_000, href: "https://data.seattle.gov/Public-Safety/Seattle-Real-Time-Fire-911-Calls/kzjm-xkqj", credit: "Seattle Fire Department · City of Seattle Open Data", coverage: "Seattle, USA. Fire and medical dispatch records from the last 48 hours. Closure and resource counts are not published." },
} satisfies Record<IncidentSource, { title: string; box: IncidentBox; refreshMs: number; href: string; credit: string; coverage: string }>;

function longitudeRanges(box: IncidentBox): [number, number][] {
  return box.west <= box.east ? [[box.west, box.east]] : [[box.west, 180], [-180, box.east]];
}
export function inside(box: IncidentBox, at: { lat: number; lon: number }): boolean {
  return at.lat >= box.south && at.lat <= box.north && longitudeRanges(box).some(([west, east]) => at.lon >= west && at.lon <= east);
}
export function overlaps(a: IncidentBox, b: IncidentBox): boolean {
  return a.north >= b.south && a.south <= b.north && longitudeRanges(a).some(([w, e]) => longitudeRanges(b).some(([bw, be]) => e >= bw && w <= be));
}
export function overlapsCoverage(source: IncidentSource, box: IncidentBox): boolean {
  return overlaps(box, SOURCES[source].box);
}
/** MapLibre can report world copies outside -180…180. Keep one geographic view for the API. */
export { geographicBox as viewBox } from "../../shared/geo";
export function inView(incident: Incident, box: IncidentBox): boolean {
  if (inside(box, incident)) return true;
  return incident.areas.some((area) => {
    const points = area.type === "Polygon" ? area.coordinates.flat() : area.coordinates.flat(2);
    if (!points.length) return false;
    const bounds = { west: Infinity, east: -Infinity, south: Infinity, north: -Infinity };
    for (const p of points) {
      bounds.west = Math.min(bounds.west, p[0] ?? 0);
      bounds.east = Math.max(bounds.east, p[0] ?? 0);
      bounds.south = Math.min(bounds.south, p[1] ?? 0);
      bounds.north = Math.max(bounds.north, p[1] ?? 0);
    }
    return overlaps(box, bounds);
  });
}
export function areaFeatures(incidents: readonly Incident[], selected: string | null): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  for (const item of incidents) {
    const properties = { id: item.id, label: item.category, alert: item.alert, selected: item.id === selected };
    for (const geometry of item.areas) features.push({ type: "Feature", properties, geometry });
  }
  return { type: "FeatureCollection", features };
}
/** Only arrivals with a recent incident time can be new; an initial snapshot or a pan stays quiet. */
export function newIncidents(items: readonly Incident[], seen: ReadonlySet<string> | null, now: number = Date.now()): Incident[] {
  if (!seen) return [];
  return items.filter((item) => !seen.has(item.id) && (item.startedAt ?? item.updatedAt ?? 0) >= now - 10 * 60_000 && (item.startedAt ?? item.updatedAt ?? 0) <= now + 60_000).slice(0, 5);
}
