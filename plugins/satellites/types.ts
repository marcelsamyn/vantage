/** Payloads served by /api/satellites. */

export const SAT_GROUPS = ["stations", "visual", "gps-ops", "weather", "starlink"] as const;
export type SatGroup = (typeof SAT_GROUPS)[number];

/** One satellite's orbital elements as a two-line element set (TLE). */
export interface Tle {
  name: string;
  norad: number;
  line1: string;
  line2: string;
}

export interface TleSet {
  group: SatGroup;
  fetchedAt: number;
  tles: Tle[];
}

/** Entity data for the Profiler. */
export interface SatelliteRef extends Tle {
  group: SatGroup;
}

declare module "../../app/core/plugin" {
  interface EntityKinds {
    satellite: SatelliteRef;
  }
}
