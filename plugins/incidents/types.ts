export type IncidentSource = "portugal" | "victoria" | "nsw" | "seattle";
export interface IncidentBox {
  west: number;
  south: number;
  east: number;
  north: number;
}
export interface Incident {
  id: string;
  source: IncidentSource;
  number: string;
  match: `${string}:${string}`[];
  title: string;
  category: string;
  status: string;
  location: string;
  lat: number;
  lon: number;
  startedAt: number | null;
  updatedAt: number | null;
  alert: boolean;
  areas: (GeoJSON.Polygon | GeoJSON.MultiPolygon)[];
  rows: [string, string][];
  href: string;
}
export interface Incidents {
  source: IncidentSource;
  fetchedAt: number;
  incidents: Incident[];
}
declare module "../../app/core/plugin" {
  interface EntityKinds {
    incident: Incident;
  }
}
