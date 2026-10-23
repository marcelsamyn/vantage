import { describe, expect, test } from "bun:test";
import { destination } from "../../shared/geo";
import { GRACE_MS, isOver, placeNearby, requeryDistanceM, SOON_MS, urgencyOf, type NearbyItem } from "./nearby";

const HERE = { lat: 41.8986, lon: 12.4769 }; // the Pantheon
const NOW = Date.UTC(2026, 9, 9, 18, 0);
const MIN = 60_000;
const at = (bearing: number, metres: number): { lat: number; lon: number } => destination(HERE, bearing, metres);

function item(id: string, over: Partial<NearbyItem> = {}): NearbyItem {
  return { id, title: id, detail: "", kind: "do", at: at(0, 100), icon: [], tone: "fog", primary: { label: "Open", run: () => undefined }, ...over };
}

const keys = (results: Parameters<typeof placeNearby>[0], radiusM = 1000, cap?: number): string[] => placeNearby(results, HERE, radiusM, NOW, cap).map((p) => p.key);

describe("urgency and expiry", () => {
  test("a departure is soon within 15 minutes, now for its grace minute, then over", () => {
    expect(urgencyOf({ startsAt: NOW + 4 * MIN }, NOW)).toBe("soon");
    expect(urgencyOf({ startsAt: NOW + SOON_MS + 1 }, NOW)).toBe("none");
    expect(urgencyOf({ startsAt: NOW - 30_000 }, NOW)).toBe("now");
    expect(isOver({ startsAt: NOW - 30_000 }, NOW)).toBe(false);
    expect(isOver({ startsAt: NOW - GRACE_MS - 1 }, NOW)).toBe(true);
  });

  test("a window is now while it lasts and over at its end, whatever its start", () => {
    expect(urgencyOf({ startsAt: NOW - 5 * MIN, until: NOW + 5 * MIN }, NOW)).toBe("now");
    expect(isOver({ startsAt: NOW - 50 * MIN, until: NOW + MIN }, NOW)).toBe(false);
    expect(isOver({ until: NOW }, NOW)).toBe(true);
    expect(urgencyOf({ until: NOW + MIN }, NOW)).toBe("now");
  });

  test("live is now; untimed is no hurry", () => {
    expect(urgencyOf({ live: true }, NOW)).toBe("now");
    expect(urgencyOf({}, NOW)).toBe("none");
  });
});

describe("placeNearby", () => {
  test("sorts by walking band first, then urgency, then distance", () => {
    const results = [
      {
        source: "bikes.nearby",
        items: [item("far-station", { at: at(90, 700) }), item("near-station", { at: at(90, 60) })],
      },
      {
        source: "transit.nearby",
        // 200 m and 300 m are both in the 2–5 minute band: the bus leaving soon goes first.
        items: [item("stop-later", { at: at(180, 200), startsAt: NOW + 40 * MIN }), item("stop-soon", { at: at(180, 300), startsAt: NOW + 4 * MIN })],
      },
      { source: "places.nearby", items: [item("landmark", { kind: "see", at: at(270, 350) })] },
    ];
    expect(keys(results)).toEqual(["bikes.nearby:near-station", "transit.nearby:stop-soon", "transit.nearby:stop-later", "places.nearby:landmark", "bikes.nearby:far-station"]);
  });

  test("things overhead and all around count as 0 m, live ones first", () => {
    const results = [
      { source: "satellites.nearby", items: [item("iss", { kind: "see", at: "overhead", startsAt: NOW + 3 * 3_600_000, until: NOW + 3 * 3_600_000 + 6 * MIN })] },
      { source: "aircraft.nearby", items: [item("plane", { kind: "see", at: "overhead", live: true })] },
      { source: "grid.nearby", items: [item("water", { at: at(45, 30) })] },
    ];
    const placed = placeNearby(results, HERE, 1000, NOW);
    expect(placed.map((p) => p.key)).toEqual(["aircraft.nearby:plane", "satellites.nearby:iss", "grid.nearby:water"]);
    expect(placed[0]?.distanceM).toBe(0);
    expect(placed[0]?.bearing).toBeNull();
    expect(placed[2]?.bearing).toBeCloseTo(45, 0);
  });

  test("drops items beyond the radius, items that are over, and repeated ids", () => {
    const results = [
      {
        source: "transit.nearby",
        items: [item("gone", { startsAt: NOW - 2 * MIN }), item("stop", { startsAt: NOW + MIN }), item("stop", { title: "duplicate" }), item("outside", { at: at(0, 1500) })],
      },
      { source: "weather.nearby", items: [item("expired-warning", { at: "here", until: NOW - 1 })] },
    ];
    const placed = placeNearby(results, HERE, 1000, NOW);
    expect(placed.map((p) => p.key)).toEqual(["transit.nearby:stop"]);
    expect(placed[0]?.title).toBe("stop");
  });

  test("the same id from two providers stays two items", () => {
    expect(keys([{ source: "a", items: [item("x")] }, { source: "b", items: [item("x")] }])).toEqual(["a:x", "b:x"]);
  });

  test("caps the list after sorting, so the nearest survive", () => {
    const many = Array.from({ length: 80 }, (_, i) => item(`p${String(i).padStart(2, "0")}`, { at: at(0, 900 - i * 10) }));
    const top = keys([{ source: "places.nearby", items: many }], 1000, 60);
    expect(top).toHaveLength(60);
    expect(top[0]).toBe("places.nearby:p79");
    expect(top).not.toContain("places.nearby:p00");
  });

  test("each kind has its own cap, so close things of one kind never crowd out another", () => {
    const sights = Array.from({ length: 10 }, (_, i) => item(`s${i}`, { kind: "see", at: at(0, 10 + i) }));
    const water = item("w", { kind: "find", at: at(0, 900) });
    const top = keys([{ source: "places.nearby", items: sights }, { source: "city.things.water", items: [water] }], 1000, 5);
    expect(top).toHaveLength(6);
    expect(top).toContain("city.things.water:w");
  });
});

test("providers are asked again after a fifth of the radius, at least 100 m", () => {
  expect(requeryDistanceM(250)).toBe(100);
  expect(requeryDistanceM(1000)).toBe(200);
  expect(requeryDistanceM(8000)).toBe(1600);
});
