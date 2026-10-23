import { describe, expect, test } from "bun:test";
import { thingItems, type KindIcons } from "./things-nearby";

// Plugin tests keep off the kernel, so the kernel's types come through the function under test.
type FusedThing = Parameters<typeof thingItems>[0][number];
type ThingTypeContribution = Parameters<typeof thingItems>[1];
type ThingMember = FusedThing["members"][number];

const AT = { lat: 41.8986, lon: 12.4769 };
const ICONS: KindIcons = { icon: "<svg/>", variants: { police: "<svg>p</svg>" } };

const type = (id: string, title: string, tone: ThingTypeContribution["tone"]): ThingTypeContribution => ({ id, title, group: "services", description: "", tone, nearby: "find", icon: async () => "<svg/>" });
const WATER = type("water", "Drinking water", "ice");
const SCOOTER = type("scooter", "Scooters", "mint");

const member = (source: string, extra: Partial<ThingMember["thing"]> = {}): ThingMember => ({
  source,
  title: source,
  attribution: null,
  thing: { id: "1", type: "water", name: null, at: AT, match: [], ...extra },
});
const fused = (key: string, dLat: number, extra: Partial<FusedThing> = {}): FusedThing => ({
  key,
  type: "water",
  name: "Drinking water",
  at: { lat: AT.lat + dLat, lon: AT.lon },
  detail: null,
  state: "unknown",
  variant: null,
  image: null,
  fact: null,
  members: [member("grid.osm")],
  ...extra,
});

describe("thingItems", () => {
  test("a fountain two registers list is one item, with every source's actions and a walk there", () => {
    const nasone = fused("water:grid.osm:node/7", 0.0004, {
      name: "Nasone",
      detail: "Cast-iron street fountain",
      image: "/assets/nasone.jpg",
      members: [
        member("grid.osm", { actions: [{ label: "Open in OpenStreetMap", href: "https://www.openstreetmap.org/node/7" }] }),
        member("dossier.nasoni", { actions: [{ label: "Open in OpenStreetMap", href: "https://www.openstreetmap.org/node/7" }] }),
      ],
    });
    const [item] = thingItems([nasone], WATER, "find", ICONS, AT, 1000);
    expect(item).toMatchObject({ id: nasone.key, title: "Nasone", detail: "Cast-iron street fountain", kind: "find", tone: "fog", image: "/assets/nasone.jpg", primary: { label: "Walk there" } });
    expect(item?.more?.map((a) => a.label)).toEqual(["Open in OpenStreetMap"]);
    expect(item?.entity).toMatchObject({ kind: "thing", id: nasone.key });
  });

  test("keeps the nearest three within reach, and names the kind when no source gives a detail", () => {
    const things = [0.0003, 0.0001, 0.002, 0.0005, 0.02].map((d, i) => fused(`n${i}`, d));
    const items = thingItems(things, WATER, "find", ICONS, AT, 1000);
    expect(items.map((i) => i.id)).toEqual(["n1", "n0", "n3"]);
    expect(items[0]).toMatchObject({ detail: "Drinking water" });
    expect(items[0]?.more).toBeUndefined();
  });

  test("a flat scooter reads as failing and a low one as a warning, like on the map", () => {
    const things = (["out", "low", "ok"] as const).map((state, i) => fused(`s${i}`, 0.0001 * (i + 1), { type: "scooter", state }));
    expect(thingItems(things, SCOOTER, "go", ICONS, AT, 1000).map((i) => [i.kind, i.tone])).toEqual([
      ["go", "alarm"],
      ["go", "sodium"],
      ["go", "mint"],
    ]);
  });

  test("a thing that names a known variant wears its icon", () => {
    const things = [fused("p", 0, { variant: "police" }), fused("q", 0.001, { variant: "unknown" })];
    expect(thingItems(things, WATER, "find", ICONS, AT, 1000).map((i) => i.icon)).toEqual(["<svg>p</svg>", "<svg/>"]);
  });

  test("nothing beyond the reach", () => {
    expect(thingItems([fused("far", 0.05)], WATER, "find", ICONS, AT, 1000)).toEqual([]);
  });
});
