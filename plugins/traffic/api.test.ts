import { afterEach, expect, mock, setSystemTime, spyOn, test } from "bun:test";
import source, {
  austinEvents,
  brusselsEvents,
  datexEvents,
  finlandEvents,
  flowTile,
  londonEvents,
  loadTraffic,
  readTrafficKey,
  tileQuery,
  tomtomBoxAllowed,
  tomtomEvents,
} from "./api";
import { trafficThings } from "./things";
import { pathFeatures } from "./paths";
import { currentEvents, inView } from "./types";
import london from "./fixtures/london.json";
import finland from "./fixtures/finland.json";
import works from "./fixtures/finland-works.json";
import brussels from "./fixtures/brussels.json";
import austin from "./fixtures/austin.json";
const NOW = Date.parse("2026-10-11T10:00:00Z");
const realFetch = globalThis.fetch;
const originalKey = process.env.VANTAGE_TOMTOM_KEY;
afterEach(() => {
  mock.restore();
  setSystemTime();
  if (originalKey === undefined) delete process.env.VANTAGE_TOMTOM_KEY;
  else process.env.VANTAGE_TOMTOM_KEY = originalKey;
});
const xml = async (name: string): Promise<string> =>
  Bun.file(new URL(`./fixtures/${name}.xml`, import.meta.url)).text();

test("London recording retains locations, comments and offsets and removes ended reports", () => {
  const events = londonEvents(london, NOW);
  expect(events[0]?.geometry).toEqual({
    type: "Point",
    coordinates: [-0.073169, 51.56544],
  });
  expect(events[0]?.description).toContain("Thames Water");
  expect(events[0]?.rows).toContainEqual(["Closures", london[0]?.hasClosures ? "Yes" : "No"]);
  expect(londonEvents([{ ...london[0], hasClosures: undefined }], NOW)[0]?.rows).toContainEqual(["Closures", "Not published"]);
  expect(events[0]?.startsAt).toBe(Date.parse("2026-10-01T10:30:00Z"));
  expect(
    londonEvents([{ ...london[0], endDateTime: "2026-10-01T00:00:00Z" }], NOW),
  ).toEqual([]);
});
test("Finland recordings preserve supplied geometry and future works stay planned", () => {
  expect(finlandEvents(finland, NOW).length).toBeLessThan(
    finland.features.length,
  );
  const event = finlandEvents(works, NOW)[0];
  expect(event?.status).toBe("planned");
  expect(event?.startsAt).toBe(Date.parse("2026-10-14T21:00:00Z"));
  expect(currentEvents(finlandEvents(works, NOW), NOW)).toEqual([]);
});
test("Brussels reads offset-free wall clock in Europe/Brussels", () => {
  const event = brusselsEvents(brussels, NOW)[0];
  expect(event?.startsAt).toBe(Date.parse("2023-06-16T07:21:00Z"));
  expect(event?.endsAt).toBe(Date.parse("2026-12-31T22:59:00Z"));
  expect(event?.rows).toContainEqual([
    "Consequences (NL)",
    "Een of meerdere afgesloten rijstroken",
  ]);
  expect(
    brusselsEvents(
      {
        ...brussels,
        features: brussels.features.map((f) => ({
          ...f,
          properties: { ...f.properties, is_active: false },
        })),
      },
      NOW,
    ),
  ).toEqual([]);
});
test("NDW uses latitude/longitude GML order, record IDs, and removes expired periods", async () => {
  const events = datexEvents(await xml("netherlands"), "netherlands", NOW);
  expect(events[0]?.geometry.type).toBe("LineString");
  expect(events[0]?.geometry.coordinates[0]).toEqual([6.128689, 52.58548]);
  expect(events.some((e) => e.geometry.type === "Point")).toBe(true);
  expect(new Set(events.map((e) => e.id)).size).toBe(events.length);
  expect(
    events.find((e) => e.id === "RWS01_M1170125_JUNCTION_CLOSURE_1_D2_WWA"),
  ).toBeUndefined();
  expect(
    events.find((e) => e.id === "RWS01_M1170125_CLOSED_LANES_D2_WWA"),
  ).toBeDefined();
});
test("France keeps the source's endpoint as a point and multilingual comments", async () => {
  const events = datexEvents(await xml("france"), "france", NOW);
  expect(events[0]?.geometry).toEqual({
    type: "Point",
    coordinates: [1.601671, 42.844486],
  });
  expect(events[0]?.description).toContain("Arrêté");
  expect(events.every((e) => e.geometry.type === "Point")).toBe(true);
  expect(() => datexEvents("<bad", "france", NOW)).toThrow("invalid XML");
});
test("Austin only admits ACTIVE records and interprets local Central time", () => {
  const events = austinEvents(austin, NOW);
  expect(events.length).toBeGreaterThan(0);
  expect(events[0]?.geometry.type).toBe("Point");
  expect(
    austinEvents(
      austin.map((r) => ({ ...r, traffic_report_status: "ARCHIVED" })),
      NOW,
    ),
  ).toEqual([]);
  expect(
    austinEvents([{ ...austin[0], date_time: "2026-10-10T12:00:00" }], NOW)[0]
      ?.startsAt,
  ).toBe(Date.parse("2026-10-10T17:00:00Z"));
});
test("TomTom Orbis uses string categories and v2 lengths and delays", () => {
  const events = tomtomEvents(
    {
      incidents: [
        {
          geometry: {
            type: "LineString",
            coordinates: [
              [4, 50],
              [4.1, 50.1],
            ],
          },
          properties: {
            id: "report-1",
            iconCategory: "roadClosed",
            events: [
              {
                description: "Road closed",
                code: 401,
                iconCategory: "roadClosed",
              },
            ],
            lengthInMeters: 321,
            delayInSeconds: 42,
            roadNumbers: ["N1"],
            timeValidity: "present",
          },
        },
      ],
    },
    NOW,
  );
  expect(events[0]?.category).toBe("roadClosed");
  expect(events[0]?.rows).toContainEqual(["Delay", "42 s"]);
  expect(trafficThings(events, NOW)).toEqual([]);
  expect(pathFeatures(events, NOW).features.length).toBe(1);
  expect(
    inView(events[0]!, { west: 4.02, east: 4.08, south: 50.02, north: 50.08 }),
  ).toBe(true);
});
test("point reports enter thing fusion with source IDs and all source facts", () => {
  const points = trafficThings(londonEvents(london, NOW), NOW);
  expect(points[0]?.match).toEqual(["traffic-london:TIMS-235739"]);
  expect(points[0]?.actions?.[0]).toMatchObject({ label: "Open source" });
  expect(pathFeatures(londonEvents(london, NOW), NOW).features).toEqual([]);
});
test("tile and area validation refuse invalid upstream requests", () => {
  expect(tileQuery.safeParse({ z: 2, x: 4, y: 1 }).success).toBe(false);
  expect(tileQuery.safeParse({ z: 22, x: 4194303, y: 0 }).success).toBe(true);
  expect(tileQuery.safeParse({ z: 23, x: 0, y: 0 }).success).toBe(false);
  expect(tomtomBoxAllowed({ west: 4, east: 4.1, south: 50, north: 50.1 })).toBe(
    true,
  );
  expect(tomtomBoxAllowed({ west: -5, east: 10, south: 41, north: 52 })).toBe(
    false,
  );
});
test("optional key failure is actionable and never includes the key", async () => {
  delete process.env.VANTAGE_TOMTOM_KEY;
  expect(readTrafficKey()).toBeNull();
  await expect(
    loadTraffic("tomtom", { west: 4, east: 4.1, south: 50, north: 50.1 }),
  ).rejects.toThrow("VANTAGE_TOMTOM_KEY");
  process.env.VANTAGE_TOMTOM_KEY = "secret-value";
  spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(
      async (_input: string | URL | Request, init?: RequestInit) => {
        expect(init?.redirect).toBe("error");
        throw new Error("oops secret-value");
      },
      { preconnect: realFetch.preconnect },
    ),
  );
  await expect(
    loadTraffic("tomtom", { west: 4.2, east: 4.3, south: 50.2, north: 50.3 }),
  ).rejects.toThrow("[key]");
});
test("regional sources outside the view make no upstream request", async () => {
  spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(
      async () => {
        throw new Error("unexpected request");
      },
      { preconnect: realFetch.preconnect },
    ),
  );
  expect(
    (await loadTraffic("austin", { west: 4, east: 5, south: 50, north: 51 }))
      .events,
  ).toEqual([]);
});
test("local API validates tiles before key setup and exposes only key presence", async () => {
  const config = source.routes["GET /config"];
  const flow = source.routes["GET /flow"];
  if (!config || !flow) throw new Error("Traffic routes missing");
  process.env.VANTAGE_TOMTOM_KEY = "never-send-this";
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    routes: {
      "/api/traffic/config": { GET: config },
      "/api/traffic/flow": { GET: flow },
    },
    error: (error) =>
      Response.json({ message: error.message }, { status: 400 }),
  });
  try {
    const response = await realFetch(`${server.url}api/traffic/config`);
    expect(await response.json()).toEqual({ tomtom: true });
    const tile = await realFetch(`${server.url}api/traffic/flow?z=1&x=2&y=0`);
    expect(tile.status).toBe(400);
    expect(await tile.text()).not.toContain("never-send-this");
  } finally {
    server.stop(true);
  }
});

test("Finland keeps the successful feed and names a failed feed", async () => {
  spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(
      async (input: string | URL | Request) => {
        if (String(input).endsWith("/roadworks"))
          throw new Error("roadworks offline");
        return Response.json(finland);
      },
      { preconnect: realFetch.preconnect },
    ),
  );
  const result = await loadTraffic("finland", {
    west: 19,
    south: 59,
    east: 32,
    north: 71,
  });
  expect(result.failed).toHaveLength(1);
  expect(result.failed[0]).toContain("Digitraffic roadworks");
  expect(result.failed[0]).toContain("roadworks offline");
  expect(result.capped).toBe(false);
});
