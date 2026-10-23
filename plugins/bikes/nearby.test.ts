import { describe, expect, test } from "bun:test";
import recorded from "./fixtures/near-brussels.json";
import { bikeItems } from "./nearby";
import type { BikesNear } from "./types";

// Villo! stations around the Grand-Place, as /api/bikes/near answered on 9 October 2026.
const data = recorded satisfies BikesNear;
const GRAND_PLACE = { lat: 50.8467, lon: 4.3525 };

describe("bikeItems", () => {
  test("lists the three nearest stations with a bike, nearest first", () => {
    const items = bikeItems(data, GRAND_PLACE, 1000);
    expect(items.map((i) => i.title)).toEqual(["PLACE SAINT-JEAN / SINT-JANSPLEIN", "AGORA", "GARE CENTRALE / CENTRAAL STATION"]);
    expect(items[0]).toMatchObject({ kind: "go", tone: "mint", detail: expect.stringMatching(/^17 bikes/) });
    expect(items[0]?.entity).toMatchObject({ kind: "bikestation", data: { networkName: "villo" } });
    expect(items[0]?.primary.label).toBe("Show bikes");
    expect(items[0]?.more?.map((a) => a.label)).toEqual(["Walk there"]);
  });

  test("ids stay unique across networks", () => {
    const ids = bikeItems(data, GRAND_PLACE, 1000).map((i) => i.id);
    expect(ids.every((id) => id.startsWith("villo:"))).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("skips a station that is not renting", () => {
    const titles = bikeItems(data, { lat: 50.8484, lon: 4.3477 }, 1000).map((i) => i.title);
    expect(titles).not.toContain("FONTAINAS");
  });

  test("adds the nearest free dock when the stations with bikes are full", () => {
    const full: BikesNear = { networks: data.networks, stations: data.stations.map((s) => ({ ...s, docks: s.name === "DE BROUCKERE" ? s.docks : 0 })) };
    const items = bikeItems(full, GRAND_PLACE, 1000);
    expect(items).toHaveLength(4);
    expect(items[3]?.title).toBe("DE BROUCKERE");
    expect(items[0]?.detail).toContain("no free docks");
  });

  test("an empty station is shown in alarm, a nearly empty one in sodium", () => {
    const thin: BikesNear = { networks: data.networks, stations: data.stations.map((s, i) => ({ ...s, bikes: i === 0 ? 2 : s.bikes })) };
    expect(bikeItems(thin, GRAND_PLACE, 1000)[0]).toMatchObject({ tone: "sodium", detail: expect.stringMatching(/^2 bikes/) });
    const none: BikesNear = { networks: data.networks, stations: data.stations.map((s) => ({ ...s, bikes: 0 })) };
    expect(bikeItems(none, GRAND_PLACE, 1000)).toMatchObject([{ title: "PLACE SAINT-JEAN / SINT-JANSPLEIN", tone: "alarm", detail: expect.stringMatching(/^No bikes · 18 docks/) }]);
  });

  test("nothing beyond the radius", () => {
    expect(bikeItems(data, GRAND_PLACE, 150)).toEqual([]);
    expect(bikeItems(data, GRAND_PLACE, 200).map((i) => i.title)).toEqual(["PLACE SAINT-JEAN / SINT-JANSPLEIN", "AGORA"]);
  });
});
