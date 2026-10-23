/** Kernel location payloads, served by /api/core. */

export interface Place {
  lat: number;
  lon: number;
  name: string;
  /** Short context line, e.g. "Rome, Italy". */
  context: string;
  /** Neighbourhood and city, e.g. "Esquilino, Rome" — the label for "where am I". */
  area: string;
  kind: string;
  countryCode: string | null;
}

export interface IpLocation {
  ip: string;
  lat: number;
  lon: number;
  city: string;
  region: string;
  country: string;
  countryCode: string;
  isp: string;
  asn: number | null;
  timezone: string;
}
