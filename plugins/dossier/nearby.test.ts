import { describe, expect, test } from "bun:test";
import recorded from "./fixtures/remarkable-brussels.json";
import { treeItems } from "./nearby";
import type { TreeTile } from "./types";

// Brussels' remarkable trees within 2.5 km of the Grand-Place, as /api/dossier/trees/remarkable answered on 10 October 2026.
const data = recorded satisfies TreeTile;
const GRAND_PLACE = { lat: 50.8467, lon: 4.3525 };

describe("treeItems", () => {
  test("lists the three nearest remarkable trees, nearest first", () => {
    const items = treeItems(data.trees, GRAND_PLACE, 2500);
    expect(items.map((i) => i.id)).toEqual(["bxl-r-3440", "bxl-r-3438", "bxl-r-3445"]);
    expect(items[0]).toMatchObject({ kind: "see", tone: "mint", detail: "Remarkable tree", primary: { label: "Show tree" } });
    expect(items[0]?.entity).toMatchObject({ kind: "place", data: { context: "Remarkable tree", kind: "tree" } });
    expect(items[0]?.more?.map((a) => a.label)).toEqual(["Walk there"]);
  });

  test("shows the register's name for the tree", () => {
    const items = treeItems(data.trees, GRAND_PLACE, 2500);
    expect(items.map((i) => i.title)).toEqual(["Ailante glanduleux", "Chêne pédonculé", "Cèdre bleu de l'Atlas"]);
  });

  test("only trees inside the radius", () => {
    expect(treeItems(data.trees, GRAND_PLACE, 500).map((i) => i.id)).toEqual(["bxl-r-3440", "bxl-r-3438"]);
  });

  test("nothing near, and nothing in a city without a register", () => {
    expect(treeItems(data.trees, GRAND_PLACE, 100)).toEqual([]);
    expect(treeItems(data.trees, { lat: 41.9, lon: 12.5 }, 8000)).toEqual([]);
    expect(treeItems([], GRAND_PLACE, 8000)).toEqual([]);
  });
});
