/** Payloads served by /api/aircraft. */

export interface Aircraft {
  /** ICAO 24-bit transponder address, lowercase hex. */
  hex: string;
  callsign: string | null;
  registration: string | null;
  /** ICAO type designator, e.g. "A20N". */
  typeCode: string | null;
  /** The receiver network's name for the type, e.g. "AIRBUS A-320neo". */
  typeName: string | null;
  /** Owner or operator as the receiver network's aircraft database lists it. */
  ownerOperator: string | null;
  /** Year built, as the receiver network's aircraft database lists it. */
  year: string | null;
  lat: number;
  lon: number;
  /** Barometric altitude in feet; null when on the ground or unknown. */
  altFt: number | null;
  onGround: boolean;
  speedKt: number | null;
  /** Indicated and true airspeed in knots, and Mach number, as the aircraft reports them. */
  iasKt: number | null;
  tasKt: number | null;
  mach: number | null;
  trackDeg: number | null;
  vertRateFpm: number | null;
  /** What the crew set on the autopilot: altitude in feet, heading in degrees, and active modes such as "autopilot" or "tcas". */
  selectedAltFt: number | null;
  selectedHeadingDeg: number | null;
  autopilotModes: string[];
  /** Wind at the aircraft, worked out by the receiver network from its speeds and headings. Direction the wind blows from. */
  windFromDeg: number | null;
  windKt: number | null;
  squawk: string | null;
  /** Declared emergency ("general", "lifeguard", "minfuel", "nordo", "unlawful", "downed"), else null. */
  emergency: string | null;
  /** ADS-B emitter category, e.g. "A3" (large airliner) or "A7" (helicopter). */
  category: string | null;
  outsideAirC: number | null;
  military: boolean;
  /** Flagged as notable (government, VIP and similar) in the receiver network's aircraft database. */
  notable: boolean;
  /** The privacy programme the aircraft is listed in: FAA LADD hides it from FAA data feeds, ICAO PIA gives it a temporary address. */
  privacyProgramme: "FAA LADD" | "ICAO PIA" | null;
  /** How the position was heard: "ADS-B", "MLAT" (worked out by several receivers), "TIS-B", "ADS-R" or "Mode S". */
  positionSource: string | null;
  /** Seconds between the position fix and `fetchedAt`. */
  posAgeS: number;
}

export interface AircraftSnapshot {
  fetchedAt: number;
  /** Which receiver network answered: "adsb.lol" or "adsb.fi". */
  source: string;
  center: { lat: number; lon: number };
  radiusNm: number;
  aircraft: Aircraft[];
}

/** Aircraft from a worldwide list (emergency squawks, military), not tied to a point on the map. */
export interface WorldwideSnapshot {
  fetchedAt: number;
  aircraft: Aircraft[];
}

export interface Airport {
  iata: string | null;
  icao: string | null;
  name: string;
  city: string | null;
  country: string | null;
  countryCode: string | null;
  lat: number;
  lon: number;
}

export interface Airline {
  name: string;
  /** ICAO airline designator, e.g. "RYR". */
  icao: string | null;
  iata: string | null;
  country: string | null;
  /** The word pilots say on the radio instead of the designator, e.g. "RYANAIR". */
  radioCallsign: string | null;
}

/** What adsbdb knows about the airframe and the flight. */
export interface AircraftDetails {
  registration: string | null;
  typeCode: string | null;
  model: string | null;
  manufacturer: string | null;
  /** The registered owner, a person or an organisation, as the registry lists it. */
  owner: string | null;
  ownerCountry: string | null;
  /** ICAO designator of the airline the owner flies as, when the registry gives one. */
  ownerAirlineCode: string | null;
  airline: Airline | null;
  flightIcao: string | null;
  flightIata: string | null;
  origin: Airport | null;
  destination: Airport | null;
}

/** A photo of the airframe itself, with the credit and link its source asks for. */
export interface AircraftPhoto {
  /** Image for the profile header. */
  src: string;
  /** Small image for list rows. */
  thumb: string;
  /** Who took it, when the source says. */
  photographer: string | null;
  source: "Planespotters.net" | "Airport-Data.com";
  /** The photo's own page at its source, where it is shown full size. */
  link: string | null;
}

/** Entity data for the Profiler: the aircraft as last seen. */
export type AircraftRef = Aircraft & { fetchedAt: number };

declare module "../../app/core/plugin" {
  interface EntityKinds {
    aircraft: AircraftRef;
  }
}
