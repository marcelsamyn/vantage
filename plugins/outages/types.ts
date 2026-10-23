import type { LatLon } from "../../shared/geo";

export interface Outage {
  id: string;
  description: string | null;
  startDate: string;
  endDate: string | null;
  eventType: string;
  dataSource: string;
  scope: string | null;
  outage: { outageCause: string; outageType: string } | null;
  asns: number[];
  asnsDetails: { asn: string; name: string | null; location: { code: string; name: string } | null }[];
  entities: { entityName: string | null; entityType: string; entityValue: string }[];
  geoIds: string[];
  locations: string[];
  locationsDetails: ({ code: string; name: string } | null)[];
  origins: string[];
  originsDetails: { name: string | null; origin: string }[];
  linkedUrl: string | null;
  tags: string[];
}

export interface OutageReport { fetchedAt: number; events: Outage[]; capped: boolean }
export interface CountryReference extends LatLon { name: string }

declare module "../../app/core/plugin" { interface EntityKinds { outage: Outage } }
