import { describe, expect, spyOn, test } from "bun:test";
import { inMediterranean, levelNear, steepestCooling } from "./argo";
import { buildProfile, floatProfile, floatsIn, parseProfileRows } from "./argo.server";
import type { ArgoLevel } from "./types";

/** The reply Ifremer's ERDDAP sent for float 1902582, dive 260, as a CSV table. */
const csv = await Bun.file(new URL("./fixtures/argo-1902582-cycle260.csv", import.meta.url)).text();

test("Argo distinguishes empty queries from missing datasets and failed upstream requests", async () => {
  const empty = 'Error {\n    code=404;\n    message="Not Found: Your query produced no matching results. (nRows = 0)";\n}\n';
  const realFetch = globalThis.fetch;
  const replies = [
    new Response(empty, { status: 404 }),
    new Response(empty, { status: 404 }),
    new Response('Error { code=404; message="Not Found: unknown dataset"; }', { status: 404 }),
    new Response(empty, { status: 503 }),
    new Response("busy", { status: 429, headers: { "retry-after": "60" } }),
  ];
  const fetch = spyOn(globalThis, "fetch").mockImplementation(Object.assign(async (): Promise<Response> => {
    const reply = replies.shift();
    if (!reply) throw new Error("Unexpected Argo request");
    return reply;
  }, { preconnect: realFetch.preconnect }));
  try {
    expect(await floatsIn({ west: 3.01, south: 50.01, east: 5.01, north: 52.01 })).toEqual([]);
    await expect(floatProfile("99000001")).rejects.toMatchObject({ status: 404, code: "no_profile" });
    await expect(floatsIn({ west: 3.02, south: 50.01, east: 5.01, north: 52.01 })).rejects.toMatchObject({ status: 502, code: "upstream_status" });
    await expect(floatsIn({ west: 3.03, south: 50.01, east: 5.01, north: 52.01 })).rejects.toMatchObject({ status: 502, code: "upstream_status" });
    await expect(floatsIn({ west: 3.04, south: 50.01, east: 5.01, north: 52.01 })).rejects.toMatchObject({ status: 503, code: "upstream_rate_limited" });
    expect(fetch).toHaveBeenCalledTimes(5);
  } finally {
    fetch.mockRestore();
  }
});

describe("a recorded dive", () => {
  const rows = parseProfileRows(csv);
  const profile = buildProfile("1902582", rows);

  test("every level of the dive is read, shallowest first, with temperature and salinity", () => {
    expect(rows.length).toBe(96);
    const levels = profile.latest.levels;
    expect(levels[0]?.presDbar).toBeLessThan(10);
    expect(levels[0]?.tempC).toBeCloseTo(25.3, 1);
    expect(levels[levels.length - 1]?.presDbar).toBeCloseTo(1983.3, 1);
    expect(levels[levels.length - 1]?.psal).toBeCloseTo(38.775, 2);
    expect(levels.map((l) => l.presDbar)).toEqual([...levels.map((l) => l.presDbar)].sort((a, b) => a - b));
  });

  test("the dive carries the time and place where the float came up", () => {
    expect(profile.latest.cycle).toBe(260);
    expect(profile.latest.time).toBe(Date.UTC(2026, 9, 5, 10, 45, 20));
    expect(profile.latest.lat).toBeCloseTo(37.583, 2);
    expect(profile.latest.lon).toBeCloseTo(17.506, 2);
    expect(profile.cycleDays).toBeNull();
  });

  test("the thermocline lies in the first few hundred metres and the water at 1,000 m is warm for an ocean", () => {
    const cooling = steepestCooling(profile.latest.levels);
    expect(cooling?.fromDbar).toBeLessThan(300);
    expect(cooling && cooling.fromC - cooling.toC).toBeGreaterThan(2);
    expect(levelNear(profile.latest.levels, 1000, 100)?.tempC).toBeGreaterThan(13);
  });
});

describe("reading dives", () => {
  const row = (cycle: number, time: string, pres: number, temp: number, extra: Partial<Record<string, string>> = {}): string =>
    [cycle, time, 40, 12, pres, temp, "38.5", "1", "1"].map((v, i) => extra[String(i)] ?? v).join(",");
  const header = "cycle_number,time,latitude,longitude,pres,temp,psal,temp_qc,pres_qc\n,UTC,degrees_north,degrees_east,decibar,degree_Celsius,PSU,,";

  test("readings flagged bad by the float's quality control are left out", () => {
    const table = [header, row(5, "2026-10-01T00:00:00Z", 10, 20), row(5, "2026-10-01T00:00:00Z", 20, 19, { "7": "4" }), row(5, "2026-10-01T00:00:00Z", 30, 18, { "8": "3" }), row(5, "2026-10-01T00:00:00Z", 40, 17, { "7": "2" })].join("\n");
    expect(parseProfileRows(table).map((r) => r.pres)).toEqual([10, 40]);
  });

  test("earlier dives become the float's track, and the median gap between dives is its rhythm", () => {
    const rows = parseProfileRows(
      [header, ...[1, 2, 3, 4].flatMap((c) => [row(c, `2026-10-0${c}T00:00:00Z`, 10, 20), row(c, `2026-10-0${c}T00:00:00Z`, 500, 14)])].join("\n"),
    );
    const profile = buildProfile("1902582", rows);
    expect(profile.latest.cycle).toBe(4);
    expect(profile.history.map((h) => h.cycle)).toEqual([1, 2, 3]);
    expect(profile.cycleDays).toBe(1);
  });

  test("a float with no good reading is reported, not drawn", () => {
    expect(() => buildProfile("1902582", [])).toThrow(/no good profile/);
  });

  test("a missing salinity stays missing instead of becoming zero", () => {
    const table = [header, row(1, "2026-10-01T00:00:00Z", 10, 20, { "6": "" })].join("\n");
    expect(buildProfile("1", parseProfileRows(table)).latest.levels[0]?.psal).toBeNull();
  });
});

describe("helpers", () => {
  const level = (presDbar: number, tempC: number): ArgoLevel => ({ presDbar, tempC, psal: null });

  test("no band that cools by less than a degree counts as a thermocline", () => {
    expect(steepestCooling([level(0, 14), level(100, 13.5), level(200, 13.2)])).toBeNull();
  });

  test("levelNear refuses a level that is too far from the depth asked for", () => {
    expect(levelNear([level(10, 20), level(500, 14)], 1000, 120)).toBeNull();
    expect(levelNear([level(10, 20), level(950, 13)], 1000, 120)?.presDbar).toBe(950);
  });

  test("Rome's sea is in the Mediterranean and the Gulf of Mexico is not", () => {
    expect(inMediterranean(41.9, 12.5)).toBe(true);
    expect(inMediterranean(25, -90)).toBe(false);
  });
});
