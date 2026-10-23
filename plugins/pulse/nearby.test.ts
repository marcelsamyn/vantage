import { describe, expect, test } from "bun:test";
import bridgesRecorded from "./fixtures/bridges-amsterdam.json";
import countersRecorded from "./fixtures/counters.json";
import parkingRecorded from "./fixtures/parking-ghent.json";
import riversRecorded from "./fixtures/rivers-ghent.json";
import { bridgeItems, counterItems, parkingItems, riverBox, riverItems } from "./nearby";
import type { BridgeFeed, CounterFeed, ParkingFeed, RiverFeed } from "./types";

// Answers of /api/pulse/* as recorded on 10 October 2026, cut down to the area around each test position. A JSON module types its strings as `string`, so the casts only narrow them to the unions the route promises.
const parking = parkingRecorded as ParkingFeed;
const bridges = bridgesRecorded as BridgeFeed;
const counters = countersRecorded as CounterFeed;
const rivers = riversRecorded as RiverFeed;

const GENT = { lat: 51.0543, lon: 3.7174 };
const AMSTERDAM = { lat: 52.3702, lon: 4.8952 };
const BRUSSELS_ETTERBEEK = { lat: 50.8466, lon: 4.3528 };
/** Three bridges report a planned opening that is under way at this moment. */
const NOW = 1_791_627_900_000;

describe("parkingItems", () => {
  test("lists the three nearest car parks with free spaces, nearest first", () => {
    const items = parkingItems(parking, GENT, 1000);
    expect(items.map((i) => i.title)).toEqual(["Ramen", "Sint-Michiels", "Vrijdagmarkt"]);
    expect(items[0]).toMatchObject({ kind: "go", tone: "mint", detail: "70 free of 261 spaces", primary: { label: "Show car park" } });
    expect(items[0]?.entity).toMatchObject({ kind: "carpark", id: "gent:Ramen" });
    expect(items[0]?.more?.map((a) => a.label)).toEqual(["Walk there"]);
  });

  test("colours by how full the car park is", () => {
    const tones = Object.fromEntries(parkingItems(parking, GENT, 1000).map((i) => [i.title, i.tone]));
    expect(tones).toEqual({ Ramen: "mint", "Sint-Michiels": "sodium", Vrijdagmarkt: "alarm" });
  });

  test("a full car park stays, saying so", () => {
    const full: ParkingFeed = { ...parking, parks: parking.parks.map((p) => (p.name === "Ramen" ? { ...p, free: 0 } : p)) };
    expect(parkingItems(full, GENT, 1000)[0]).toMatchObject({ title: "Ramen", tone: "alarm", detail: "Full of 261 spaces" });
  });

  test("skips car parks that are closed or report no count, and one without a capacity says only what is free", () => {
    const messy: ParkingFeed = {
      errors: [],
      parks: parking.parks.map((p) => (p.name === "Ramen" ? { ...p, open: false } : p.name === "Sint-Michiels" ? { ...p, free: null } : p.name === "Vrijdagmarkt" ? { ...p, capacity: null } : p)),
    };
    const items = parkingItems(messy, GENT, 1000);
    expect(items.map((i) => i.title)).toEqual(["Vrijdagmarkt", "Savaan", "Reep"]);
    expect(items[0]?.detail).toBe("5 free");
  });

  test("nothing in the radius, and nothing in a city without a feed", () => {
    expect(parkingItems(parking, GENT, 100)).toEqual([]);
    expect(parkingItems(parking, AMSTERDAM, 8000)).toEqual([]);
  });
});

describe("riverItems", () => {
  const nearEvergem = { lat: 51.1062, lon: 3.7175 };

  test("lists the nearest gauges that report a level", () => {
    const items = riverItems(rivers, nearEvergem, 8000);
    expect(items.map((i) => i.title)).toEqual(["Evergem RWZI Ringvaart", "Oostakker/Wittewalle", "Waarschoot/Brakeleijken"]);
    expect(items[1]).toMatchObject({ kind: "see", tone: "mint", detail: "5.70 m, falling 0.03 m in 3 h · normal" });
    expect(items[0]).toMatchObject({ tone: "fog", detail: "-0.16 m, steady over 3 h" });
    expect(items[1]?.entity).toMatchObject({ kind: "rivergauge", id: items[1]?.id });
  });

  test("a gauge without a level is left out", () => {
    const silent: RiverFeed = { errors: [], gauges: rivers.gauges.map((g) => (g.name === "Evergem RWZI Ringvaart" ? { ...g, level: null, trend3h: null } : g)) };
    expect(riverItems(silent, nearEvergem, 8000).map((i) => i.title)).not.toContain("Evergem RWZI Ringvaart");
  });

  test("an elevated gauge is sodium and a high one alarm", () => {
    const flood: RiverFeed = { errors: [], gauges: rivers.gauges.map((g) => (g.name === "Oostakker/Wittewalle" ? { ...g, status: "high" as const } : g.name === "Waarschoot/Brakeleijken" ? { ...g, status: "elevated" as const } : g)) };
    const tones = Object.fromEntries(riverItems(flood, nearEvergem, 8000).map((i) => [i.title, i.tone]));
    expect(tones).toMatchObject({ "Oostakker/Wittewalle": "alarm", "Waarschoot/Brakeleijken": "sodium" });
  });

  test("nothing in the radius, and a box that the route accepts", () => {
    expect(riverItems(rivers, GENT, 2000)).toEqual([]);
    const box = riverBox(GENT, 100_000);
    expect(box.east - box.west).toBeLessThan(0.3);
    expect(box.north - box.south).toBeLessThan(0.2);
    expect(box).toEqual(riverBox(GENT, 8000));
  });
});

describe("bridgeItems", () => {
  /** Beside a bridge whose planned opening is under way at NOW, and about 2 km from the next one. */
  const BESIDE_OPEN = { lat: 52.3702, lon: 4.865 };

  test("a planned opening under way has an end time, so the row counts down to it", () => {
    const [item] = bridgeItems(bridges, BESIDE_OPEN, 300, NOW);
    expect(item).toMatchObject({ id: "NLAMS002120531200035", kind: "see", tone: "sodium", title: "Movable bridge", detail: "Open for a planned opening", startsAt: 1_791_627_720_000, until: 1_791_628_080_000 });
    expect(item?.entity).toMatchObject({ kind: "bridgeopening", data: { bridge: { code: "NLAMS002120531200035" } } });
    expect(item?.entity?.data).not.toHaveProperty("opening");
  });

  test("a bridge that reports itself open with no end is live", () => {
    const reported: BridgeFeed = { ...bridges, bridges: bridges.bridges.map((b) => (b.now ? { ...b, now: { phase: "reported" as const, from: b.now.from, until: null } } : b)) };
    const [item] = bridgeItems(reported, BESIDE_OPEN, 300, NOW);
    expect(item).toMatchObject({ live: true, detail: "Reports itself open" });
    expect(item).not.toHaveProperty("startsAt");
  });

  test("a closed bridge shows its next opening, with the name the source gives", () => {
    const quiet: BridgeFeed = { ...bridges, bridges: bridges.bridges.map((b) => ({ ...b, now: null })) };
    const items = bridgeItems(quiet, AMSTERDAM, 5000, NOW);
    expect(items.map((i) => i.title)).toEqual(["Nassaukade", "Movable bridge", "Movable bridge"]);
    expect(items[0]).toMatchObject({ tone: "fog", detail: "Planned opening", startsAt: 1_791_628_500_000, until: 1_791_628_860_000 });
  });

  test("an opening more than six hours away is not mentioned", () => {
    const quiet: BridgeFeed = { ...bridges, bridges: bridges.bridges.map((b) => ({ ...b, now: null })) };
    expect(bridgeItems(quiet, AMSTERDAM, 5000, NOW - 7 * 3_600_000)).toEqual([]);
  });

  test("skips an opening that is over and takes the next one", () => {
    const quiet: BridgeFeed = { ...bridges, bridges: bridges.bridges.map((b) => ({ ...b, now: null })) };
    const bridge = quiet.bridges.find((b) => b.code === "NLAMS002122253000074");
    const later = (bridge?.upcoming[0]?.until ?? 0) + 60_000;
    const [item] = bridgeItems(quiet, { lat: bridge?.lat ?? 0, lon: bridge?.lon ?? 0 }, 100, later);
    expect(item?.startsAt).toBe(bridge?.upcoming[1]?.from);
  });

  test("nothing outside the Netherlands", () => {
    expect(bridgeItems(bridges, GENT, 8000, NOW)).toEqual([]);
  });
});

describe("counterItems", () => {
  test("lists the three nearest counters with the street, today's count and the hour", () => {
    const items = counterItems(counters, BRUSSELS_ETTERBEEK, 2500);
    expect(items.map((i) => i.title)).toEqual(["Avenue des Arts 26", "Boulevard Poincaré 75", "Quai des Charbonnages 8"]);
    expect(items[0]).toMatchObject({ kind: "see", tone: "sodium", detail: "1,713 cyclists today · 85 this hour" });
  });

  test("a counter that publishes a month at a time says which day it counts", () => {
    const [item] = counterItems(counters, GENT, 5000);
    expect(item).toMatchObject({ tone: "fog", detail: expect.stringMatching(/ on the latest published day$/) });
  });

  test("one cyclist is singular, and a counter with no day is skipped", () => {
    const one: CounterFeed = { counters: counters.counters.map((c) => (c.name.startsWith("Avenue des Arts") ? { ...c, day: 1, hour: null } : c.name.startsWith("Boulevard") ? { ...c, day: null } : c)) };
    const items = counterItems(one, BRUSSELS_ETTERBEEK, 2500);
    expect(items.map((i) => i.title)).not.toContain("Boulevard Poincaré 75");
    expect(items.find((i) => i.title === "Avenue des Arts 26")?.detail).toBe("1 cyclist today");
  });

  test("nothing in the radius", () => {
    expect(counterItems(counters, BRUSSELS_ETTERBEEK, 500)).toEqual([]);
  });
});
