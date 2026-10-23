import { expect, test } from "bun:test";
import { gridThings } from "./things";
import type { GridFeature, GridKind } from "./types";

const feature = (osm: string, kind: GridKind, lon: number, lat: number, name: string | null = null, tags: Record<string, string> = {}, web: string | null = null, ids: GridFeature["properties"]["ids"] = []): GridFeature => ({
  type: "Feature",
  geometry: { type: "Point", coordinates: [lon, lat] },
  properties: { kind, osm, name, tags, web, directions: [], ids },
});

const features = [
  feature("node/1", "water", 4.3532, 50.8469, null, { bottle: "yes" }),
  feature("node/2", "toilets", 4.353, 50.8465, null, { fee: "no" }),
  feature("node/3", "hospital", 4.354, 50.847, "Sint-Pieters", { emergency: "yes", "addr:street": "Hoogstraat", "addr:housenumber": "322" }, null, ["wikidata:Q2302458"]),
  feature("node/4", "camera", 4.3526, 50.8468),
  feature("way/5", "ev", 4.3549, 50.8463, null, { capacity: "4" }, "https://example.org/charger"),
];

test("only the wanted types come back, and a kind with a layer of its own never does", () => {
  const things = gridThings(features, new Set(["water", "toilets", "emergency", "ev", "camera"]));
  expect(things.map((t) => t.type)).toEqual(["water", "toilets", "emergency", "ev"]);
});

test("things carry their OpenStreetMap reference, so another survey of the same object merges with them", () => {
  const [water] = gridThings(features, new Set(["water"]));
  expect(water?.match).toEqual(["osm:node/1"]);
  expect(water?.id).toBe("node/1");
});

test("things carry the codes their tags give in other registers, after their own reference", () => {
  expect(gridThings(features, new Set(["emergency"]))[0]?.match).toEqual(["osm:node/3", "wikidata:Q2302458"]);
});

test("an object without a name is labelled with what it is, and only a mapped name counts as its name", () => {
  const [water] = gridThings(features, new Set(["water"]));
  expect(water?.name).toBeNull();
  expect(water?.label).toBe("Drinking fountain");
  expect(gridThings(features, new Set(["emergency"]))[0]?.name).toBe("Sint-Pieters");
});

test("the three emergency services share one switch and wear their own marks", () => {
  expect(gridThings(features, new Set(["emergency"]))[0]?.variant).toBe("hospital");
  expect(gridThings(features, new Set(["water"]))[0]?.variant).toBeUndefined();
});

test("the tags become rows, and the address becomes the line under the name", () => {
  const [hospital] = gridThings(features, new Set(["emergency"]));
  expect(hospital?.detail).toBe("Hoogstraat 322");
  expect(hospital?.rows).toContainEqual(["Emergency department", "Yes"]);
});

test("every mapped object can be read and corrected at the source", () => {
  const [water] = gridThings(features, new Set(["water"]));
  expect(water?.actions?.map((a) => a.label)).toEqual(["Open in OpenStreetMap", "Fix in OpenStreetMap"]);
  expect(water?.actions?.[1]).toMatchObject({ href: "https://www.openstreetmap.org/edit?node=1#map=19/50.84690/4.35320" });
});

test("a website the server checked is offered too", () => {
  const [charger] = gridThings(features, new Set(["ev"]));
  expect(charger?.actions?.map((a) => a.label)).toEqual(["Open in OpenStreetMap", "Fix in OpenStreetMap", "Open its website"]);
  expect(charger?.actions?.[1]).toMatchObject({ href: "https://www.openstreetmap.org/edit?way=5#map=19/50.84630/4.35490" });
});
