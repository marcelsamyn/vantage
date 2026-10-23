import { describe, expect, test } from "bun:test";
import { eraItem } from "./nearby";
import type { Era } from "./types";

const AT = { lat: 50.8467, lon: 4.3525 };
const era = (id: string, year: number, kind: Era["kind"]): Era => ({
  id,
  year,
  yearLabel: String(year),
  name: id,
  label: `${year} · ${id}`,
  kind,
  context: "",
  publisher: "Geopunt",
  licence: "Open",
  tiles: "https://tiles.example/{z}/{x}/{y}.png",
  minzoom: 0,
  maxzoom: 18,
  viewZoom: 16,
});

describe("eraItem", () => {
  test("the oldest picture of the spot is something to see, with a couple of later ones after", () => {
    const item = eraItem([era("ferraris", 1777, "map"), era("vandermaelen", 1850, "map"), era("aerial-1950", 1950, "aerial"), era("aerial-2020", 2020, "aerial"), era("orbit", 2024, "orbit")], AT);
    expect(item).toMatchObject({ kind: "see", at: "here", title: "This street in 1777", primary: { label: "Show it" } });
    expect(item?.more?.map((a) => a.label)).toEqual(["Show 1850", "Show 2020"]);
  });

  test("nothing when only views from orbit exist", () => {
    expect(eraItem([era("orbit", 2024, "orbit")], AT)).toBeNull();
  });
});
