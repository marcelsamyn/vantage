/**
 * Pages about an aircraft's identifiers on other sites. Each link is built from a part checked here, so an odd value
 * gives no link rather than a wrong one. Every URL scheme was checked against the site that serves it.
 */

const squash = (value: string): string => value.replace(/\s+/g, "").toUpperCase();

/** The aircraft live on ADS-B Exchange's map, which selects it with `?icao=`. */
export function trackerLink(hex: string): string | null {
  const h = hex.trim().toLowerCase();
  return /^[0-9a-f]{6}$/.test(h) ? `https://globe.adsbexchange.com/?icao=${h}` : null;
}

/** The flight on FlightAware. Callsigns of all digits (some military aircraft send "00000") name no flight. */
export function flightLink(callsign: string | null): string | null {
  const id = callsign ? squash(callsign) : "";
  return /^(?=.*[A-Z])[A-Z0-9]{2,8}$/.test(id) ? `https://www.flightaware.com/live/flight/${id}` : null;
}

/** US registrations open the FAA registry record; others open the airframe on Planespotters.net, found by its transponder address. */
export function registrationLink(registration: string | null, hex: string): string | null {
  const reg = registration ? squash(registration) : "";
  if (/^N[1-9][0-9A-Z]{0,4}$/.test(reg)) return `https://registry.faa.gov/AircraftInquiry/Search/NNumberResult?NNumbertxt=${reg}`;
  const h = hex.trim().toUpperCase();
  return reg && /^[0-9A-F]{6}$/.test(h) ? `https://www.planespotters.net/hex/${h}` : null;
}

/** readsb's aircraft database files ground vehicles and towers under these pseudo types. */
const NOT_TYPES = new Set(["GND", "TWR"]);

/** The type's page on SKYbrary, keyed by the ICAO type designator. */
export function typeLink(typeCode: string | null): string | null {
  const code = typeCode ? squash(typeCode) : "";
  return /^(?=.*[A-Z])[A-Z0-9]{2,4}$/.test(code) && !NOT_TYPES.has(code) ? `https://skybrary.aero/aircraft/${code.toLowerCase()}` : null;
}

/** An airline's fleet on FlightAware when its ICAO designator is known, else a search of company registers on OpenCorporates. */
export function companyLink(name: string | null, airlineCode: string | null): string | null {
  const code = airlineCode ? squash(airlineCode) : "";
  if (/^[A-Z]{3}$/.test(code)) return `https://www.flightaware.com/live/fleet/${code}`;
  const q = name?.replace(/\s+/g, " ").trim();
  return q ? `https://opencorporates.com/companies?${new URLSearchParams({ q })}` : null;
}
