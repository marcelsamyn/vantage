/** Degrees clockwise from north, only when the source gives a single unambiguous direction. */
export function directionBearing(direction: string | null | undefined): number | null {
  if (!direction?.trim()) return null;
  const text = direction.trim();
  if (/^[+-]?\d+(?:\.\d+)?(?:°)?$/.test(text)) {
    const degrees = Number(text.replace("°", ""));
    if (!Number.isFinite(degrees)) return null;
    const bearing = degrees % 360;
    return bearing < 0 ? bearing + 360 : bearing;
  }
  const point = text.toUpperCase().replace(/BOUND$/, "").replace(/NORTH/g, "N").replace(/SOUTH/g, "S").replace(/EAST/g, "E").replace(/WEST/g, "W").replace(/[ -]/g, "");
  const points: Readonly<Record<string, number>> = { N: 0, NNE: 22.5, NE: 45, ENE: 67.5, E: 90, ESE: 112.5, SE: 135, SSE: 157.5, S: 180, SSW: 202.5, SW: 225, WSW: 247.5, W: 270, WNW: 292.5, NW: 315, NNW: 337.5 };
  const bearing = points[point];
  if (bearing !== undefined) return bearing;
  // TfL labels a direction before a road name or a parenthesized description.
  const labelled = text.match(/^((?:north|south)(?:[ -](?:east|west))?|east|west)\s*(?:-(?!east\b|west\b)|\()/i);
  return labelled ? directionBearing(labelled[1]) : null;
}
