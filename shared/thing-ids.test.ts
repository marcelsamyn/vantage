import { expect, test } from "bun:test";
import { evseIds, ifoptIds, osmId, schemeOf, uicIds, wikidataIds } from "./thing-ids";

test("every source writes the same code the same way", () => {
  expect(osmId("node/123")).toBe("osm:node/123");
  expect(wikidataIds("q42")).toEqual(["wikidata:Q42"]);
  expect(evseIds("BE*ALL*E123*1")).toEqual(evseIds("beallE1231"));
  expect(evseIds("BE*ALL*E123*1")).toEqual(["evse:BEALLE1231"]);
});

test("several codes in one tag, as OpenStreetMap writes them, become several identifiers", () => {
  expect(wikidataIds("Q1; Q2")).toEqual(["wikidata:Q1", "wikidata:Q2"]);
  expect(evseIds("DE*ABC*E1;DE*ABC*E2")).toEqual(["evse:DEABCE1", "evse:DEABCE2"]);
});

test("a platform's IFOPT code names its station", () => {
  expect(ifoptIds("de:08111:6115:1:2")).toEqual(["ifopt:de:08111:6115"]);
  expect(ifoptIds("DE:08111:6115")).toEqual(["ifopt:de:08111:6115"]);
});

test("whatever does not fit the scheme is left out rather than guessed at", () => {
  expect(wikidataIds("Douglas Adams")).toEqual([]);
  expect(uicIds("88140010")).toEqual([]);
  expect(uicIds("8814001")).toEqual(["uic:8814001"]);
  expect(ifoptIds("08111:6115")).toEqual([]);
  expect(evseIds("not a charger")).toEqual([]);
  expect(wikidataIds(undefined)).toEqual([]);
});

test("the scheme is everything before the first colon", () => {
  expect(schemeOf("ifopt:de:08111:6115")).toBe("ifopt");
});
