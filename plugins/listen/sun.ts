import * as SunCalc from "suncalc";

/** Where the sun is, for the "day or night there" readout and the shaded night side of the listening map. */

export type Daylight = "day" | "twilight" | "night";

/** Sun altitude in degrees above the horizon at a place and moment. */
export function sunAltitudeDeg(lat: number, lon: number, at: Date): number {
  return (SunCalc.getPosition(at, lat, lon).altitude * 180) / Math.PI;
}

/** Day starts when the sun's upper edge clears the horizon (-0.833°). Below -12° the sky is dark. */
export function daylightAt(lat: number, lon: number, at: Date): Daylight {
  const altitude = sunAltitudeDeg(lat, lon, at);
  if (altitude > -0.833) return "day";
  return altitude > -12 ? "twilight" : "night";
}

/** The time at a place: the zone's own clock when known, else the sun's clock (UTC shifted by longitude). */
export function clockAt(timezone: string | null, lon: number, at: Date): { text: string; kind: "local" | "solar" } {
  if (timezone) {
    try {
      return { text: new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit" }).format(at), kind: "local" };
    } catch {
      /* An unknown zone name falls through to solar time. */
    }
  }
  const solar = new Date(at.getTime() + (lon / 15) * 3_600_000);
  return { text: `${String(solar.getUTCHours()).padStart(2, "0")}:${String(solar.getUTCMinutes()).padStart(2, "0")}`, kind: "solar" };
}

const rad = (d: number): number => (d * Math.PI) / 180;
const deg = (r: number): number => (r * 180) / Math.PI;

/** The point on Earth where the sun is overhead (low-precision solar position, good to about 0.01°). */
export function subsolarPoint(at: Date): { lat: number; lon: number } {
  const n = at.getTime() / 86_400_000 + 2440587.5 - 2451545.0;
  const meanLon = (280.46 + 0.9856474 * n) % 360;
  const anomaly = rad((357.528 + 0.9856003 * n) % 360);
  const eclipticLon = rad(meanLon + 1.915 * Math.sin(anomaly) + 0.02 * Math.sin(2 * anomaly));
  const obliquity = rad(23.439 - 0.0000004 * n);
  const declination = Math.asin(Math.sin(obliquity) * Math.sin(eclipticLon));
  const rightAscension = Math.atan2(Math.cos(obliquity) * Math.sin(eclipticLon), Math.cos(eclipticLon));
  const sidereal = (280.46061837 + 360.98564736629 * n) % 360;
  const lon = ((deg(rightAscension) - sidereal + 540) % 360) - 180;
  return { lat: deg(declination), lon };
}

/**
 * The night side of the planet as a GeoJSON polygon on the flat map. It follows the line where the sun sits on
 * the horizon and closes over the pole that is in darkness. Latitudes stop at 85° where Mercator ends.
 */
export function nightPolygon(at: Date): GeoJSON.Feature<GeoJSON.Polygon> {
  const sun = subsolarPoint(at);
  // At an equinox the line runs from pole to pole; a hair of declination keeps the tangent finite.
  const tanDec = Math.tan(rad(Math.abs(sun.lat) < 0.01 ? 0.01 : sun.lat));
  const edge: [number, number][] = [];
  for (let lon = -180; lon <= 180; lon += 2) {
    const hourAngle = rad(lon - sun.lon);
    const lat = Math.max(-85, Math.min(85, deg(Math.atan(-Math.cos(hourAngle) / tanDec))));
    edge.push([lon, lat]);
  }
  // With the sun north of the equator, night lies south of the line, and the other way round.
  const pole = sun.lat >= 0 ? -85 : 85;
  return { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [[...edge, [180, pole], [-180, pole], edge[0] ?? [-180, 0]]] } };
}
