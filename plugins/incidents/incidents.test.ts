import { expect, test } from "bun:test";
import { incidentThings } from "./things";
import pt from "./fixtures/pt.json";
import vic from "./fixtures/vic.json";
import nsw from "./fixtures/nsw.json";
import seattle from "./fixtures/seattle.json";
import { parseIncidents, incidentsInBox } from "./api";
import { overlapsCoverage, inside, areaFeatures, newIncidents, inView, viewBox } from "./model";

const now = Date.parse("2026-10-11T09:00:00Z");
test("Portugal keeps open incidents that began months ago and publishes operational counts", () => {
  const records = parseIncidents("portugal", pt);
  expect(records).toHaveLength(2);
  expect(records[0]?.id).toBe("portugal:20260190881");
  expect(records[0]?.status).toBe("Chegada ao TO");
  expect(records[0]?.startedAt).toBe(1770285600000);
  expect(records[0]?.rows).toContainEqual(["Personnel", "2"]);
  expect(records[0]?.lon).toBe(-8.132459);
});
test("Victoria reads local start time in Melbourne and numeric update timestamps", () => {
  const records = parseIncidents("victoria", vic);
  expect(records[0]?.startedAt).toBe(Date.parse("2026-10-11T05:28:00Z"));
  expect(records[0]?.updatedAt).toBe(1791707700000);
  expect(records[0]?.rows).toContainEqual(["Resources", "16"]);
});
test("NSW preserves nested fire polygons and Sydney updated time instead of ambiguous pubDate", () => {
  const records = parseIncidents("nsw", nsw);
  expect(records[0]?.updatedAt).toBe(Date.parse("2026-10-11T05:18:00Z"));
  expect(records[0]?.status).toBe("Under control");
  expect(records[0]?.areas).toHaveLength(1);
  const features = areaFeatures(records, null).features;
  expect(features[0]?.geometry.type).toBe("Polygon");
  expect(features).toHaveLength(2);
  expect(features.every((feature) => feature.geometry.type === "Polygon")).toBe(true);
  expect(features[0]?.properties).toMatchObject({ id: records[0]?.id, selected: false });
});
test("Seattle keeps 48 hours of dispatches without claiming the response is still active", () => {
  const records = parseIncidents("seattle", seattle, now);
  expect(records[0]?.startedAt).toBe(Date.parse("2026-10-11T08:37:00Z"));
  expect(records[0]?.status).toBe("Dispatch record · closure not published");
  expect(parseIncidents("seattle", seattle, now + 49 * 3600000)).toEqual([]);
});
test("an unexpected feed shape, impossible coordinate or invalid date is rejected", () => {
  expect(() => parseIncidents("victoria", { results: [{ ...vic.results[0], latitude: 95 }] })).toThrow();
  expect(() => parseIncidents("seattle", [{ ...seattle[0], datetime: "not a date" }])).toThrow();
  expect(() => parseIncidents("nsw", { type: "FeatureCollection", features: [] })).not.toThrow();
  expect(() => parseIncidents("victoria", {})).toThrow();
});
test("coverage and positions support a dateline view and exclude Rome", () => {
  expect(overlapsCoverage("portugal", { west: 12, east: 13, south: 41, north: 42 })).toBe(false);
  expect(overlapsCoverage("nsw", { west: 150, east: 154, south: -35, north: -30 })).toBe(true);
  expect(inside({ west: 170, east: -170, south: -20, north: 20 }, { lat: 0, lon: -175 })).toBe(true);
});
test("feed baseline is quiet, moving the map does not announce old incidents, and new incidents announce once", () => {
  const records = parseIncidents("victoria", vic);
  const [first, second] = records;
  if (!first || !second) throw new Error("Recorded Victoria incidents missing");
  expect(newIncidents(records, null, now)).toEqual([]);
  expect(newIncidents(records, new Set(), now + 86400000)).toEqual([]);
  expect(newIncidents(records, new Set([first.id]), Date.parse("2026-10-11T08:45:00Z")).map((x) => x.id)).toEqual([second.id]);
});

test("world copies normalize to the same region, and a visible fire outline survives an off-screen marker", () => {
  const records = parseIncidents("nsw", nsw);
  const incident = records[0];
  if (!incident) throw new Error("Recorded NSW incident missing");
  expect(viewBox({ west: 510, east: 514, south: -35, north: -30 })).toEqual({ west: 150, east: 154, south: -35, north: -30 });
  expect(viewBox({ west: -210, east: 210, south: -90, north: 90 })).toEqual({ west: -180, east: 180, south: -90, north: 90 });
  expect(inView(incident, { west: 151.198, east: 151.1995, south: -32.720, north: -32.715 })).toBe(true);
  expect(inside({ west: 151.198, east: 151.1995, south: -32.720, north: -32.715 }, incident)).toBe(false);
});
test("impossible calendar dates fail at the incident boundary", () => {
  expect(() => parseIncidents("victoria", { results: [{ ...vic.results[0], originDateTime: "31/02/2026 12:00:00" }] })).toThrow("invalid");
  expect(() => parseIncidents("seattle", [{ ...seattle[0], datetime: "2026-02-31T12:00:00.000" }])).toThrow("invalid");
});
test("incident things publish stable identifiers, source details and official actions", () => {
  const items = incidentThings(parseIncidents("victoria", vic));
  expect(items[0]?.type).toBe("incident");
  expect(items[0]?.match).toEqual(["victoria:297153"]);
  expect(items[0]?.state).toBe("out");
  expect(items[0]?.rows).toContainEqual(["Resources", "16"]);
  expect(items[0]?.actions?.[0]).toEqual({ label: "Open official incident information", href: "https://emergency.vic.gov.au/respond/" });
});
test("an unsupported area returns empty without asking any upstream", async () => {
  const records = await incidentsInBox("portugal", { west: 12, east: 13, south: 41, north: 42 }, now);
  expect(records).toEqual({ source: "portugal", fetchedAt: now, incidents: [] });
});

test("Seattle skips a call it has not geocoded yet and keeps the rest of the feed", () => {
  const { latitude: _lat, longitude: _lon, report_location: _at, ...unplaced } = seattle[0]!;
  const records = parseIncidents("seattle", [{ ...unplaced, incident_number: "F-UNPLACED" }, ...seattle], now);
  expect(records.some((r) => r.id.includes("F-UNPLACED"))).toBe(false);
  expect(records).toHaveLength(parseIncidents("seattle", seattle, now).length);
});
test("Seattle rejects blank and null coordinates instead of drawing them at zero", () => {
  expect(() => parseIncidents("seattle", [{ ...seattle[0], latitude: null }])).toThrow();
  expect(() => parseIncidents("seattle", [{ ...seattle[0], longitude: "" }])).toThrow();
});
test("Portugal publishes every source identifier to the map merger", () => {
  expect(incidentThings(parseIncidents("portugal", pt))[0]?.match).toEqual(["portugal:20260190881", "anepc-id:26712881", "anepc-feature:49959278"]);
});

test("refresh arrivals use the current time when the original query is an hour old", () => {
  const incident = parseIncidents("victoria", vic)[0];
  if (!incident) throw new Error("Recorded Victoria incident missing");
  const fresh = { ...incident, id: "victoria:stationary-regression", startedAt: Date.now() };
  expect(newIncidents([fresh], new Set(), fresh.startedAt - 3600000)).toEqual([]);
  expect(newIncidents([fresh], new Set())).toEqual([fresh]);
});
