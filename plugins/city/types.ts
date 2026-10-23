import type { Place } from "../../shared/location";

/** Payloads served by /api/city. */

export interface Structure {
  name: string | null;
  kind: string;
  levels: number | null;
  heightM: number | null;
  built: string | null;
  architect: string | null;
  operator: string | null;
  website: string | null;
  osmUrl: string;
}

export interface Article {
  title: string;
  extract: string;
  thumbnail: string | null;
  url: string;
  distanceM: number;
}

export interface WhatsHere {
  lat: number;
  lon: number;
  place: Place | null;
  elevationM: number | null;
  article: Article | null;
}

export type TravelMode = "foot" | "bike" | "car";

export interface Route {
  mode: TravelMode;
  distanceM: number;
  durationS: number;
  /** [lon, lat] pairs. */
  line: [number, number][];
}
