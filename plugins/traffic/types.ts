export const TRAFFIC_FLOW_REFRESH_MS = 5 * 60_000;

export type TrafficSourceId =
  | "tomtom"
  | "london"
  | "finland"
  | "netherlands"
  | "brussels"
  | "france"
  | "austin";
export interface TrafficBox {
  west: number;
  south: number;
  east: number;
  north: number;
}
export type TrafficGeometry =
  | GeoJSON.Point
  | GeoJSON.LineString
  | GeoJSON.MultiLineString
  | GeoJSON.Polygon
  | GeoJSON.MultiPolygon;
export interface TrafficEvent {
  id: string;
  source: TrafficSourceId;
  title: string;
  description: string;
  location: string;
  category: string;
  severity: string;
  status: "active" | "planned";
  startsAt: number | null;
  endsAt: number | null;
  updatedAt: number | null;
  geometry: TrafficGeometry;
  lengthM?: number;
  rows: [string, string][];
  url: string;
}
export interface TrafficResult {
  events: TrafficEvent[];
  fetchedAt: number;
  capped: boolean;
  failed: string[];
}
export interface TrafficSourceInfo {
  id: TrafficSourceId;
  title: string;
  credit: string;
  url: string;
  area: TrafficBox | null;
  refreshMs: number;
}
export const TRAFFIC_SOURCES: readonly TrafficSourceInfo[] = [
  {
    id: "tomtom",
    title: "TomTom",
    credit: "© TomTom",
    url: "https://developer.tomtom.com/",
    area: null,
    refreshMs: 300_000,
  },
  {
    id: "london",
    title: "Transport for London",
    credit: "Powered by TfL Open Data",
    url: "https://tfl.gov.uk/traffic/status/",
    area: { west: -0.6, south: 51.2, east: 0.4, north: 51.8 },
    refreshMs: 60_000,
  },
  {
    id: "finland",
    title: "Fintraffic",
    credit: "Fintraffic / Digitraffic (CC BY 4.0)",
    url: "https://www.digitraffic.fi/en/road-traffic/",
    area: { west: 19, south: 59, east: 32, north: 71 },
    refreshMs: 60_000,
  },
  {
    id: "netherlands",
    title: "NDW Netherlands",
    credit: "NDW",
    url: "https://docs.ndw.nu/",
    area: { west: 3, south: 50.5, east: 7.5, north: 54 },
    refreshMs: 60_000,
  },
  {
    id: "brussels",
    title: "Brussels Mobility",
    credit: "Brussels Mobility (CC0)",
    url: "https://data.mobility.brussels/fr/info/events/",
    area: { west: 4.2, south: 50.7, east: 4.6, north: 51 },
    refreshMs: 3_600_000,
  },
  {
    id: "france",
    title: "Bison Futé / DIR",
    credit: "Bison Futé / DIR (Licence Ouverte 2.0)",
    url: "https://transport.data.gouv.fr/datasets/evenements-routiers-sur-le-reseau-routier-national-non-concede/",
    area: { west: -5.5, south: 41, east: 10, north: 51.5 },
    refreshMs: 3_600_000,
  },
  {
    id: "austin",
    title: "Austin traffic reports",
    credit: "City of Austin / CTECC",
    url: "https://data.austintexas.gov/Transportation-and-Mobility/Real-Time-Traffic-Incident-Reports/dx9v-zd7x",
    area: { west: -98.2, south: 29.8, east: -97.2, north: 30.8 },
    refreshMs: 300_000,
  },
];
export function overlaps(a: TrafficBox, b: TrafficBox): boolean {
  return (
    a.west <= b.east &&
    a.east >= b.west &&
    a.south <= b.north &&
    a.north >= b.south
  );
}
export function inView(event: TrafficEvent, box: TrafficBox): boolean {
  const positions: GeoJSON.Position[] = [];
  switch (event.geometry.type) {
    case "Point":
      positions.push(event.geometry.coordinates);
      break;
    case "LineString":
      positions.push(...event.geometry.coordinates);
      break;
    case "MultiLineString":
    case "Polygon":
      positions.push(...event.geometry.coordinates.flat());
      break;
    case "MultiPolygon":
      positions.push(...event.geometry.coordinates.flat(2));
      break;
  }
  // A segment or polygon can cross the view even when every vertex is outside it.
  return overlaps(box, {
    west: Math.min(...positions.map((p) => p[0] ?? 0)),
    east: Math.max(...positions.map((p) => p[0] ?? 0)),
    south: Math.min(...positions.map((p) => p[1] ?? 0)),
    north: Math.max(...positions.map((p) => p[1] ?? 0)),
  });
}
export function currentEvents(
  events: readonly TrafficEvent[],
  now: number,
): TrafficEvent[] {
  return events.filter(
    (e) =>
      e.status === "active" &&
      (e.startsAt === null || e.startsAt <= now) &&
      (e.endsAt === null || e.endsAt > now),
  );
}
