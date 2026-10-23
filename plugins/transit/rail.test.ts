import { expect, test } from "bun:test";
import { brusselsDay, buildWorks, distanceToLineM, worksNear, type WorkRow } from "./rail.server";

const row = (over: Partial<WorkRow>): WorkRow => ({
  id: 1,
  line: "36",
  tracks: "A+B",
  date_begin: "2026-10-01",
  date_end: "2026-12-31",
  time_begin: "04:00:00",
  time_end: "04:00:00",
  continuity: "Continuous",
  impact_level: "Minor",
  impact_description: "Temporary Speed Restriction",
  start_commercialname_dutch: "Vertrijk",
  end_commercialname_dutch: "Ezemaal",
  details_geo_shape: { geometry: { type: "MultiLineString", coordinates: [[[4.0, 50.8], [4.1, 50.8]]] } },
  ...over,
});

test("distance to a line is measured to the nearest point on a segment, not only to its ends", () => {
  // 0.001 degrees of latitude is about 110 m, and the line runs east to west a long way past the point.
  const metres = distanceToLineM({ lat: 50.801, lon: 4.05 }, [[4.0, 50.8], [4.1, 50.8]]);
  expect(metres).toBeGreaterThan(105);
  expect(metres).toBeLessThan(115);
});

test("works are ordered major first, then started, and a repeated filing appears once", () => {
  const { works } = buildWorks(
    [
      row({ id: 1, impact_level: "Minor", date_begin: "2026-10-01" }),
      row({ id: 2, impact_level: "Major", date_begin: "2026-11-15" }),
      row({ id: 3, impact_level: "Major", date_begin: "2026-09-01" }),
      row({ id: 3, impact_level: "Major", date_begin: "2026-09-01" }),
    ],
    "2026-10-09",
  );
  expect(works.map((w) => w.id.split("-")[0])).toEqual(["3", "2", "1"]);
  expect(works.map((w) => w.started)).toEqual([true, false, true]);
});

test("a row without a shape cannot be drawn and is dropped", () => {
  expect(buildWorks([row({ details_geo_shape: null })], "2026-10-09").works).toHaveLength(0);
});

test("worksNear keeps what is within the radius and puts the nearest first", () => {
  const { works } = buildWorks([row({ id: 1 }), row({ id: 2, details_geo_shape: { geometry: { type: "MultiLineString", coordinates: [[[4.0, 50.81], [4.1, 50.81]]] } } })], "2026-10-09");
  const near = worksNear(works, { lat: 50.8, lon: 4.05 }, 2000);
  expect(near.map((n) => n.work.id.split("-")[0])).toEqual(["1", "2"]);
  expect(worksNear(works, { lat: 50.8, lon: 4.05 }, 500).map((n) => n.work.id.split("-")[0])).toEqual(["1"]);
});

test("the works date follows Brussels, not UTC", () => {
  // 23:30 UTC on 8 October is already 9 October in Brussels (UTC+2).
  expect(brusselsDay(Date.parse("2026-10-08T23:30:00Z"))).toBe("2026-10-09");
  expect(brusselsDay(Date.parse("2026-10-08T21:59:00Z"))).toBe("2026-10-08");
});
