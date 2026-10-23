import { describe, expect, test } from "bun:test";
import { mergeAlerts } from "./alerts.server";
import { Trip, alertsOf, departureOf, tripDetail } from "./transitous.server";
import type { TransitAlert } from "./types";

const NOW = Date.parse("2026-10-11T08:00:00Z");

type StopTime = Parameters<typeof departureOf>[0];

const stopTime = (over: Partial<StopTime> = {}): StopTime => ({
  place: { name: "Gent Korenmarkt perron 3", stopId: "be-delijn_gs:delijn:200780", lat: 51.05, lon: 3.72, departure: "2026-10-11T08:17:00Z", scheduledDeparture: "2026-10-11T08:16:00Z" },
  mode: "TRAM",
  realTime: true,
  headsign: "Melle Leeuw",
  tripId: "20261011_08:01_be-delijn_1.T2.1",
  routeShortName: "T2",
  displayName: "T2",
  agencyName: "De Lijn",
  ...over,
});

const run = (alerts: Parameters<typeof alertsOf>[0][number]["alerts"], route = "T2"): Parameters<typeof alertsOf>[0][number] => ({ alerts, route, operator: "De Lijn" });

const strike = {
  headerText: "Grève des services publics le 12 octobre",
  descriptionText: "En raison de la journée de grève\r\ndu 12 octobre,   le réseau sera perturbé. (@letec)",
  cause: "STRIKE",
  effect: "REDUCED_SERVICE",
  url: "https://letec.be/Traffic/Detail/5215",
  impactPeriod: [{ start: "2026-10-11T22:01:00Z", end: "2026-10-12T21:59:00Z" }],
};

describe("alertsOf", () => {
  test("one alert per notice, with the lines of every departure that carries it", () => {
    const out = alertsOf([run([strike]), run([strike], "6"), run([strike])], NOW);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      operator: "De Lijn",
      title: "Grève des services publics le 12 octobre",
      text: "En raison de la journée de grève\ndu 12 octobre, le réseau sera perturbé.",
      routes: ["T2", "6"],
      severity: "alarm",
      from: Date.parse("2026-10-11T22:01:00Z"),
      until: Date.parse("2026-10-12T21:59:00Z"),
      link: "https://letec.be/Traffic/Detail/5215",
    });
  });

  test("drops a notice whose every period has ended, keeps one without periods, and refuses a non-web link", () => {
    const ended = { headerText: "Old works", descriptionText: "", impactPeriod: [{ start: "2026-09-01T00:00:00Z", end: "2026-10-01T00:00:00Z" }] };
    const open = { headerText: "", descriptionText: "Platform 1 closed", url: "javascript:alert(1)", effect: "DETOUR" };
    const out = alertsOf([run([ended, open])], NOW);
    expect(out.map((a) => [a.title, a.severity, a.from, a.until, a.link])).toEqual([["Service change", "sodium", null, null, null]]);
  });

  test("falls back to the communication period when the impact period is empty, and ignores unreadable times", () => {
    const a = { headerText: "Works", descriptionText: "", impactPeriod: [], communicationPeriod: [{ start: "2026-10-01T00:00:00Z", end: "garbage" }] };
    expect(alertsOf([run([a])], NOW).map((x) => [x.from, x.until])).toEqual([[Date.parse("2026-10-01T00:00:00Z"), null]]);
  });

  test("an alert open at one end has no end date", () => {
    const openEnded = { ...strike, impactPeriod: [{ start: "2026-10-01T00:00:00Z" }, { start: "2026-10-11T00:00:00Z", end: "2026-10-12T00:00:00Z" }] };
    expect(alertsOf([run([openEnded])], NOW)[0]?.until).toBeNull();
  });
});

describe("departureOf", () => {
  test("a trip cancelled as a whole is cancelled at this stop too", () => {
    expect(departureOf(stopTime({ tripCancelled: true })).cancelled).toBe(true);
    expect(departureOf(stopTime()).cancelled).toBe(false);
  });

  test("reads accessibility only when the operator states it", () => {
    expect(departureOf(stopTime({ wheelchairAccessible: "ACCESSIBLE" })).accessible).toBe(true);
    expect(departureOf(stopTime({ wheelchairAccessible: "NOT_ACCESSIBLE" })).accessible).toBe(false);
    expect(departureOf(stopTime({ wheelchairAccessible: "UNKNOWN" })).accessible).toBeNull();
  });

  test("strips Trenitalia's agency code from the line name", () => {
    expect(departureOf(stopTime({ tripId: "20261011_08:01_it-trenitalia_9512", displayName: "0083_FR" })).route).toBe("FR");
  });
});

describe("mergeAlerts", () => {
  const alert = (id: string, title: string, severity: TransitAlert["severity"], from: number | null): TransitAlert => ({ id, operator: "SNCB", title, text: "", routes: [], stops: [], severity, from, until: null, link: null });

  test("keeps one copy of a notice two sources publish, worst first", () => {
    const out = mergeAlerts([alert("a", "Works Gent–Brugge", "sodium", 1)], [alert("b", "works gent - brugge", "sodium", 2), alert("c", "No trains", "alarm", null)]);
    expect(out.map((a) => a.id)).toEqual(["c", "a"]);
  });
});

describe("tripDetail", () => {
  const call = (name: string, at: string | null, actual: string | null, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
    name,
    lat: 51,
    lon: 3.7,
    ...(at ? { scheduledDeparture: at, departure: actual ?? at, scheduledArrival: at, arrival: actual ?? at } : {}),
    ...extra,
  });
  const leg = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
    mode: "BUS",
    displayName: "10",
    headsign: "Mariakerke Post",
    agencyName: "De Lijn",
    realTime: true,
    from: call("Gent Dampoort", "2026-10-11T07:50:00Z", null),
    intermediateStops: [call("Korenmarkt", "2026-10-11T07:58:00Z", "2026-10-11T08:01:00Z", { track: "3", scheduledTrack: "3" }), call("Rabot", "2026-10-11T08:04:00Z", "2026-10-11T08:07:00Z", { cancelled: true }), call("Mariakerke Plein", "2026-10-11T08:09:00Z", "2026-10-11T08:12:00Z")],
    to: { name: "Mariakerke Post", lat: 51.07, lon: 3.68, scheduledArrival: "2026-10-11T08:15:00Z", arrival: "2026-10-11T08:18:00Z" },
    alerts: [strike],
    ...over,
  });
  const parse = (l: Record<string, unknown>): ReturnType<typeof Trip.parse> => Trip.parse({ legs: [l] });

  test("marks the calls already made, skips a cancelled call for the next stop, and reads the delay there", () => {
    const t = tripDetail("trip-1", parse(leg()), NOW);
    expect(t.stops.map((s) => [s.name, s.passed, s.cancelled])).toEqual([
      ["Gent Dampoort", true, false],
      ["Korenmarkt", false, false],
      ["Rabot", false, true],
      ["Mariakerke Plein", false, false],
      ["Mariakerke Post", false, false],
    ]);
    expect(t).toMatchObject({ label: "10", status: "running", delayMin: 3, destination: "Mariakerke Post", origin: "Gent Dampoort" });
    expect(t.stops[0]?.arrival).toEqual({ planned: Date.parse("2026-10-11T07:50:00Z"), actual: Date.parse("2026-10-11T07:50:00Z") });
    expect(t.stops[4]?.departure).toBeNull();
    expect(t.alerts.map((a) => a.routes)).toEqual([["10"]]);
  });

  test("a run that has not left is scheduled; one past its last stop has arrived; a cancelled run says so", () => {
    expect(tripDetail("t", parse(leg()), Date.parse("2026-10-11T07:00:00Z")).status).toBe("scheduled");
    expect(tripDetail("t", parse(leg()), Date.parse("2026-10-11T09:00:00Z")).status).toBe("arrived");
    expect(tripDetail("t", parse(leg({ cancelled: true })), NOW).status).toBe("cancelled");
  });

  test("without real-time data there is no delay", () => {
    expect(tripDetail("t", parse(leg({ realTime: false })), NOW).delayMin).toBeNull();
  });
});
