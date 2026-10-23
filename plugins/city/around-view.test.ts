import { describe, expect, test } from "bun:test";
import { aroundItems, aroundTab } from "./around-view";

type Item = Parameters<typeof aroundItems>[0][number];

function item(id: string, source: string, patch: Partial<Item> = {}): Item {
  return {
    id,
    key: `${source}:${id}`,
    source,
    title: id,
    detail: "",
    kind: "see",
    at: { lat: 50.85, lon: 4.35 },
    icon: "",
    tone: "mint",
    live: true,
    primary: { label: "Open", run: () => {} },
    distanceM: 100,
    bearing: 0,
    urgency: "now",
    ...patch,
  };
}

const camera = (id: string): Item => item(id, "webcams.nearby");
const departure = (id: string): Item => item(id, "transit.nearby", { kind: "go", live: undefined, urgency: "soon" });

describe("Around me view", () => {
  test("Everything includes every category and routine readings without the Now cap", () => {
    const items = [
      ...Array.from({ length: 8 }, (_, i) => camera(`camera${i}`)),
      departure("bus"),
      item("water", "city.things.water", { kind: "find", urgency: "none" }),
      item("receiver", "reach.receivers", { kind: "do", urgency: "none" }),
      item("normal", "sensors.air"),
    ];
    expect(aroundItems(items, "all", false)).toEqual(items);
    expect(aroundItems(items, "all", true)).toEqual(items);
  });

  test("keeps live cameras, audio feeds and imminent transit in Now", () => {
    const items = [camera("cam"), item("audio", "listen.nearby", { kind: "do" }), departure("bus"), item("water", "city.things.water", { kind: "find", live: undefined, urgency: "none" })];
    expect(aroundItems(items, "now", false).map((i) => i.id)).toEqual(["cam", "audio", "bus"]);
  });

  test("keeps routine sensors in See and includes their warnings in Now", () => {
    const items = [item("normal", "sensors.air"), item("missing", "sensors.noise", { tone: "fog" }), item("high", "sensors.air", { tone: "sodium" }), item("danger", "sensors.radiation", { tone: "alarm" })];
    expect(aroundItems(items, "now", true).map((i) => i.id)).toEqual(["high", "danger"]);
    expect(aroundItems(items, "see", false)).toEqual(items);
  });

  test("limits the initial mix to two items per source without changing their order", () => {
    const items = [camera("a"), camera("b"), camera("c"), departure("d"), departure("e"), departure("f"), item("audio", "listen.nearby", { kind: "do" })];
    expect(aroundItems(items, "now", false).map((i) => i.id)).toEqual(["a", "b", "d", "e", "audio"]);
    expect(aroundItems(items, "now", true)).toEqual(items);
  });

  test("stops the initial mix at six even when each source is different", () => {
    const items = Array.from({ length: 9 }, (_, i) => item(String(i), `source.${i}`));
    expect(aroundItems(items, "now", false)).toEqual(items.slice(0, 6));
    expect(aroundItems(items, "now", true)).toEqual(items);
  });

  test("other tabs include their entire kind, including things without urgency", () => {
    const items = [camera("cam"), departure("bus"), item("water", "city.things.water", { kind: "find", urgency: "none" }), item("receiver", "reach.receivers", { kind: "do", urgency: "none" }), ...Array.from({ length: 8 }, (_, i) => departure(`stop${i}`))];
    expect(aroundItems(items, "go", false)).toEqual(items.filter((i) => i.kind === "go"));
    expect(aroundItems(items, "find", false).map((i) => i.id)).toEqual(["water"]);
    expect(aroundItems(items, "do", false).map((i) => i.id)).toEqual(["receiver"]);
    expect(aroundItems(items, "see", false).map((i) => i.id)).toEqual(["cam"]);
  });

  test("handles an empty response", () => {
    expect(aroundItems([], "now", false)).toEqual([]);
  });

  test("restores a valid saved tab and falls back for invalid storage", () => {
    expect(aroundTab("all")).toBe("all");
    expect(aroundTab("find")).toBe("find");
    for (const value of [null, "unknown", 3, {}, ["see"]]) expect(aroundTab(value)).toBe("all");
  });
});
