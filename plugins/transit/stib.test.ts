import { describe, expect, test } from "bun:test";
import { placeVehicles, stibPoint, stibRows, withStibPredictions } from "./stib.server";
import type { Departure } from "./types";

describe("stibPoint", () => {
  test("drops the platform letter and refuses other operators", () => {
    expect(stibPoint("be-stib_3348A")).toBe("3348");
    expect(stibPoint("be-stib_8022")).toBe("8022");
    expect(stibPoint("be-delijn_gs:delijn:300714")).toBeNull();
    expect(stibPoint("be-stib_")).toBeNull();
  });
});

describe("stibRows", () => {
  test("reads the passing times STIB nests as a JSON string, with bilingual destinations and remarks", () => {
    const rows = stibRows({
      results: [
        {
          pointid: "1000",
          lineid: "38",
          passingtimes:
            '[{"destination":{"fr":"GARE CENTRALE","nl":"CENTRAAL STATION"},"expectedArrivalTime":"2026-10-11T10:23:45.473+02:00","lineId":"38","message":{"de":"Nichteinsteigen","fr":"Ne pas embarquer","nl":"Niet instappen","en":"Do not embark"}}]',
        },
        { pointid: "8022", lineid: "1", passingtimes: '[{"destination":{"fr":"STOCKEL","nl":"STOKKEL"},"expectedArrivalTime":"2026-10-11T10:28:22.999+02:00","lineId":"1"},{"destination":{"fr":"STOCKEL","nl":"STOCKEL"},"expectedArrivalTime":"2026-10-11T10:38:22.999+02:00","lineId":"1"}]' },
      ],
    });
    expect(rows.map((r) => [r.route, r.headsign, r.time, r.scheduled, r.note])).toEqual([
      ["38", "Gare Centrale / Centraal Station", Date.parse("2026-10-11T08:23:45.473Z"), null, "Do not embark"],
      ["1", "Stockel / Stokkel", Date.parse("2026-10-11T08:28:22.999Z"), null, null],
      ["1", "Stockel", Date.parse("2026-10-11T08:38:22.999Z"), null, null],
    ]);
  });

  test("leaves out a prediction without a readable time", () => {
    expect(stibRows({ results: [{ pointid: "1", lineid: "1", passingtimes: '[{"lineId":"1","expectedArrivalTime":"soon"}]' }] })).toEqual([]);
  });

  test("a broken nested string is an upstream error, not a crash", () => {
    expect(() => stibRows({ results: [{ pointid: "1", lineid: "1", passingtimes: "[{" }] })).toThrow("STIB sent a response that is not JSON");
  });
});

describe("withStibPredictions", () => {
  const T = Date.parse("2026-10-11T08:00:00Z");
  const row = (route: string, min: number, tripId: string, over: Partial<Departure> = {}): Departure => ({
    tripId,
    route,
    headsign: "",
    mode: "",
    time: T + min * 60_000,
    scheduled: T + min * 60_000,
    realTime: false,
    cancelled: false,
    track: null,
    trackChanged: false,
    agency: "",
    routeColor: null,
    routeTextColor: null,
    accessible: null,
    note: null,
    train: null,
    occupancy: null,
    ...over,
  });

  test("predictions replace a line's timetable per direction, up to the last prediction; other lines and operators stay", () => {
    const timetable = [
      row("1", 2, "20261011_09:58_be-stib_1", { mode: "SUBWAY", routeColor: "C4008F", headsign: "STOCKEL" }),
      row("1", 25, "20261011_10:21_be-stib_2", { mode: "SUBWAY", headsign: "STOCKEL" }),
      row("1", 20, "20261011_10:16_be-stib_5", { mode: "SUBWAY", headsign: "GARE DE L'OUEST" }),
      row("29", 4, "20261011_09:58_be-stib_3", { mode: "BUS", headsign: "DE BROUCKERE" }),
      row("1", 5, "20261011_09:58_be-delijn_4", { mode: "BUS", headsign: "Melle" }),
    ];
    const live = [
      row("1", 3, "stib:8022:1:a", { realTime: true, scheduled: null, headsign: "Stockel / Stokkel" }),
      row("1", 12, "stib:8022:1:b", { realTime: true, scheduled: null, headsign: "Stockel / Stokkel" }),
      row("1", 8, "stib:8021:1:c", { realTime: true, scheduled: null, headsign: "Gare De L'Ouest / Weststation" }),
      row("1", 40, "stib:8021:1:d", { realTime: true, scheduled: null, headsign: "Gare De L'Ouest / Weststation" }),
    ];
    const out = withStibPredictions(timetable, live);
    expect(out.map((d) => d.tripId)).toEqual(["stib:8022:1:a", "20261011_09:58_be-stib_3", "20261011_09:58_be-delijn_4", "stib:8021:1:c", "stib:8022:1:b", "20261011_10:21_be-stib_2", "stib:8021:1:d"]);
    expect(out[0]).toMatchObject({ mode: "SUBWAY", routeColor: "C4008F" });
  });
});

describe("placeVehicles", () => {
  // Line 4 both ways: the live API names the direction "4507", a stop near Stalle that is not its last one.
  const lines = [
    { line: "4", mode: "TRAM", destination: "Stalle (P)", stops: [{ point: "531", lat: 50.85, lon: 4.35 }, { point: "501", lat: 50.84, lon: 4.35 }, { point: "4507", lat: 50.81, lon: 4.33 }, { point: "4502", lat: 50.8, lon: 4.32 }] },
    { line: "4", mode: "TRAM", destination: "Gare du Nord / Noordstation", stops: [{ point: "4501", lat: 50.8, lon: 4.32 }, { point: "502", lat: 50.84, lon: 4.35 }, { point: "526", lat: 50.86, lon: 4.36 }] },
  ];
  const at = 1_791_700_000;
  const vehicles = (positions: object[]): ReturnType<typeof placeVehicles> => placeVehicles(lines, { results: [{ lineid: "4", vehiclepositions: JSON.stringify(positions) }] }, at);

  test("puts a vehicle the reported distance past its stop, towards the next one, in its own direction", () => {
    const [v] = vehicles([{ directionId: "4507", distanceFromPoint: 556, pointId: "0531" }]);
    expect(v).toMatchObject({ route: "4", mode: "TRAM", label: "Line 4 to Stalle (P)", at: 0, receivedAt: at * 1000, evidence: "route-distance" });
    expect(v?.lat).toBeCloseTo(50.845, 3);
    expect(v?.lon).toBeCloseTo(4.35, 5);
  });

  test("stops at the next stop when the distance overshoots, and stays on the last stop at the end of the line", () => {
    const [past, end] = vehicles([
      { directionId: "636", distanceFromPoint: 99_999, pointId: "502" },
      { directionId: "4507", distanceFromPoint: 0, pointId: "4502" },
    ]);
    expect([past?.lat, past?.lon]).toEqual([50.86, 4.36]);
    expect([end?.lat, end?.lon]).toEqual([50.8, 4.32]);
  });

  test("leaves out a vehicle on a stop the line does not list", () => {
    expect(vehicles([{ directionId: "4507", distanceFromPoint: 10, pointId: "9999" }])).toEqual([]);
  });
});
