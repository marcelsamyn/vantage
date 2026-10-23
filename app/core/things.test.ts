import { expect, test } from "bun:test";
import { fuseThings, thingActions, type Thing, type ThingBatch, type ThingSourceContribution, type ThingTypeContribution } from "./things";

const type = (id: string, extra: Partial<ThingTypeContribution> = {}): ThingTypeContribution => ({
  id,
  title: id === "water" ? "Drinking water" : id,
  group: "services",
  description: "",
  nearby: "find",
  tone: "ice",
  icon: async () => [],
  ...extra,
});

const source = (id: string, extra: Partial<ThingSourceContribution> = {}): ThingSourceContribution => ({
  id,
  title: id,
  types: ["water"],
  load: async () => ({ default: async () => {} }),
  ...extra,
});

const thing = (id: string, at: { lat: number; lon: number }, extra: Partial<Thing> = {}): Thing => ({ id, type: "water", name: null, at, match: [], ...extra });

const batch = (id: string, things: Thing[], extra: Partial<ThingSourceContribution> = {}): ThingBatch => ({ source: source(id, extra), things });

const AT = { lat: 41.9, lon: 12.5 };
/** About 10 m north of AT: inside the default 25 m merge radius. */
const NEAR = { lat: 41.90009, lon: 12.5 };
/** About 55 m north of AT. */
const FAR = { lat: 41.9005, lon: 12.5 };
/** `m` metres north of AT. */
const north = (m: number): { lat: number; lon: number } => ({ lat: AT.lat + m / 111_320, lon: AT.lon });

test("a thing without a name or a label is called after its type", () => {
  const [fused] = fuseThings([batch("osm", [thing("node/1", AT)])], [type("water")]);
  expect(fused?.name).toBe("Drinking water");
  expect(fused?.key).toBe("water:osm:node/1");
  expect(fused?.members).toHaveLength(1);
});

test("a name from any source beats a label, and a label beats the type's title", () => {
  const labelled = fuseThings([batch("osm", [thing("a", AT, { label: "Drinking fountain" })]), batch("rome", [thing("b", NEAR, { label: "Nasone" })])], [type("water")]);
  expect(labelled.map((t) => t.name)).toEqual(["Drinking fountain"]);
  const named = fuseThings([batch("osm", [thing("a", AT, { label: "Drinking fountain" })]), batch("rome", [thing("b", NEAR, { name: "Fontanella del Facchino" })])], [type("water")]);
  expect(named.map((t) => t.name)).toEqual(["Fontanella del Facchino"]);
});

test("two sources that name the same identifier are one thing", () => {
  const fused = fuseThings(
    [
      batch("osm", [thing("node/1", AT, { match: ["osm:node/1"], rows: [["Fee", "none"]] })]),
      batch("rome", [thing("2214", FAR, { match: ["osm:node/1"], name: "Nasone" })]),
    ],
    [type("water")],
  );
  expect(fused).toHaveLength(1);
  expect(fused[0]?.members.map((m) => m.source)).toEqual(["osm", "rome"]);
  // The leading source keeps the key; the first source with a name of its own names it.
  expect(fused[0]?.key).toBe("water:osm:node/1");
  expect(fused[0]?.name).toBe("Nasone");
});

test("two sources close together with nothing to contradict them are one thing", () => {
  const fused = fuseThings([batch("osm", [thing("a", AT)]), batch("rome", [thing("b", NEAR)])], [type("water")]);
  expect(fused).toHaveLength(1);
  // The fused position is the mean of what the sources report.
  expect(fused[0]?.at.lat).toBeCloseTo((AT.lat + NEAR.lat) / 2, 6);
});

test("names that disagree keep two things apart", () => {
  const fused = fuseThings([batch("osm", [thing("a", AT, { name: "Fontanella Trevi" })]), batch("rome", [thing("b", NEAR, { name: "Nasone 12" })])], [type("water")]);
  expect(fused).toHaveLength(2);
});

test("the same name written differently still agrees", () => {
  const fused = fuseThings([batch("osm", [thing("a", AT, { name: "Nasone 12" })]), batch("rome", [thing("b", NEAR, { name: "nasone-12" })])], [type("water")]);
  expect(fused).toHaveLength(1);
  expect(fuseThings([batch("osm", [thing("a", AT, { name: "Café Nord" })]), batch("city", [thing("b", NEAR, { name: "CAFE NORD" })])], [type("water")])).toHaveLength(1);
});

test("names in other scripts are compared, not dropped", () => {
  const fused = fuseThings([batch("osm", [thing("a", AT, { name: "Аптека" })]), batch("city", [thing("b", NEAR, { name: "Почта" })])], [type("water")]);
  expect(fused).toHaveLength(2);
});

test("different codes in one register keep two reports apart, however close they stand", () => {
  const fused = fuseThings([batch("osm", [thing("a", AT, { match: ["osm:node/1"] })]), batch("rome", [thing("b", NEAR, { match: ["osm:node/2"] })])], [type("water")]);
  expect(fused).toHaveLength(2);
});

test("codes in different registers say nothing against each other, so position decides", () => {
  const fused = fuseThings([batch("osm", [thing("a", AT, { match: ["osm:node/1"] })]), batch("city", [thing("b", NEAR, { match: ["wikidata:Q1"] })])], [type("water")]);
  expect(fused).toHaveLength(1);
});

test("a report that carries two codes joins the reports that carry one each", () => {
  const fused = fuseThings(
    [batch("osm", [thing("a", AT, { match: ["osm:node/1"] })]), batch("wiki", [thing("b", FAR, { match: ["wikidata:Q1"] })]), batch("city", [thing("c", north(300), { match: ["wikidata:Q1", "osm:node/1"] })])],
    [type("water")],
  );
  expect(fused).toHaveLength(1);
  expect(fused[0]?.members.map((m) => m.source)).toEqual(["osm", "wiki", "city"]);
});

test("a report joins the nearest candidate, not the first one found", () => {
  // The city's fountain stands 22 m from one mapped fountain and 18 m from the other.
  const fused = fuseThings([batch("osm", [thing("a1", AT), thing("a2", north(40))]), batch("city", [thing("c", north(22))])], [type("water")]);
  expect(fused.find((t) => t.members.length === 2)?.members.map((m) => m.thing.id)).toEqual(["a2", "c"]);
});

test("a row of reports never chains into one thing", () => {
  const fused = fuseThings([batch("osm", [thing("a", AT)]), batch("city", [thing("b", north(20))]), batch("rome", [thing("c", north(40))])], [type("water")]);
  expect(fused).toHaveLength(2);
  expect(Math.max(...fused.map((t) => t.members.length))).toBe(2);
});

test("a police station beside a fire station stays two, though one switch shows both", () => {
  const fused = fuseThings([batch("osm", [thing("a", AT, { variant: "police" })]), batch("city", [thing("b", NEAR, { variant: "fire" })])], [type("water")]);
  expect(fused).toHaveLength(2);
});

test("a type can widen or narrow how close counts as the same thing", () => {
  const batches = [batch("osm", [thing("a", AT)]), batch("rome", [thing("b", FAR)])];
  expect(fuseThings(batches, [type("water")])).toHaveLength(2);
  expect(fuseThings(batches, [type("water", { mergeM: 100 })])).toHaveLength(1);
});

test("one source listing two fountains at one spot means two fountains", () => {
  expect(fuseThings([batch("osm", [thing("a", AT), thing("b", NEAR)])], [type("water")])).toHaveLength(2);
});

test("a thing of a type nobody declared is left out", () => {
  expect(fuseThings([batch("osm", [thing("a", AT, { type: "mystery" })])], [type("water")])).toEqual([]);
});

test("the worst state any source reports is the one shown", () => {
  const fused = fuseThings([batch("osm", [thing("a", AT, { state: "ok", match: ["ref:x"] })]), batch("rome", [thing("b", AT, { state: "out", match: ["ref:x"] })])], [type("water")]);
  expect(fused[0]?.state).toBe("out");
});

test("a thing nobody reports a state for has none", () => {
  expect(fuseThings([batch("osm", [thing("a", AT)])], [type("water")])[0]?.state).toBe("unknown");
});

test("actions come in source order, once per label", () => {
  const fused = fuseThings(
    [
      batch("osm", [thing("a", AT, { match: ["ref:x"], actions: [{ label: "Fix in OpenStreetMap", href: "https://example.org/edit" }] })]),
      batch("rome", [thing("b", AT, { match: ["ref:x"], actions: [{ label: "Fix in OpenStreetMap", href: "https://example.org/other" }, { label: "Rent now", href: "https://example.org/rent" }] })]),
    ],
    [type("water")],
  );
  const actions = thingActions(fused[0] as NonNullable<(typeof fused)[number]>);
  expect(actions.map((a) => a.label)).toEqual(["Fix in OpenStreetMap", "Rent now"]);
  expect(actions[0]).toMatchObject({ href: "https://example.org/edit" });
});

test("two sources agree on a fountain far north, where a degree of longitude is short", () => {
  // Tromsø, 69°N: 20 m east is a much larger step in longitude than the same walk in Rome.
  const at = { lat: 69.6496, lon: 18.956 };
  const east = { lat: 69.6496, lon: 18.956517 };
  expect(fuseThings([batch("osm", [thing("a", at)]), batch("city", [thing("b", east)])], [type("water")])).toHaveLength(1);
});
