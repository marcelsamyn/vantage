import { describe, expect, test } from "bun:test";
import { clockAt, daylightAt, nightPolygon, subsolarPoint } from "./sun";

/** Ray casting on the flat map: is the point inside the polygon's ring? */
function inside(ring: readonly (readonly number[])[], lon: number, lat: number): boolean {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i] ?? [0, 0];
    const [xj, yj] = ring[j] ?? [0, 0];
    if (yi !== undefined && yj !== undefined && xi !== undefined && xj !== undefined && yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

describe("sun", () => {
  const night = new Date("2026-10-08T23:30:00Z"); // 01:30 in Rome
  const noon = new Date("2026-10-08T10:30:00Z"); // 12:30 in Rome

  test("Rome is dark at 01:30 and bright at 12:30", () => {
    expect(daylightAt(41.9, 12.5, night)).toBe("night");
    expect(daylightAt(41.9, 12.5, noon)).toBe("day");
  });

  test("the sun is overhead at the sub-solar point", () => {
    const s = subsolarPoint(noon);
    // On 8 October the sun stands about 6° south of the equator. It crosses the Greenwich meridian at 11:48 UTC
    // (the equation of time is +12 min), so at 10:30 UTC it is 78 min of arc, 19.5°, east of it.
    expect(s.lat).toBeCloseTo(-6, 0);
    expect(Math.abs(s.lon - 19.5)).toBeLessThan(1);
    expect(daylightAt(s.lat, s.lon, noon)).toBe("day");
  });

  test("the night polygon covers Rome at 01:30 and not at 12:30", () => {
    const ring = (at: Date): readonly (readonly number[])[] => nightPolygon(at).geometry.coordinates[0] ?? [];
    expect(inside(ring(night), 12.5, 41.9)).toBe(true);
    expect(inside(ring(noon), 12.5, 41.9)).toBe(false);
  });

  test("the polygon agrees with the sun at places around the globe", () => {
    const ring = nightPolygon(night).geometry.coordinates[0] ?? [];
    for (const [lat, lon] of [
      [-33.9, 151.2],
      [35.7, 139.7],
      [40.7, -74],
      [-23.5, -46.6],
    ] as const) {
      const dark = daylightAt(lat, lon, night) !== "day";
      expect(inside(ring, lon, lat)).toBe(dark);
    }
  });

  test("shows the zone's own clock, and the sun's clock when the zone is unknown or invalid", () => {
    expect(clockAt("Europe/Rome", 12.5, night)).toEqual({ text: "01:30", kind: "local" });
    expect(clockAt(null, 15, night)).toEqual({ text: "00:30", kind: "solar" });
    expect(clockAt("Not/AZone", 15, night).kind).toBe("solar");
  });
});
