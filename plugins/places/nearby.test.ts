import { describe, expect, test } from "bun:test";
import { articleItems } from "./nearby";
import type { Article } from "./types";

const AT = { lat: 50.8467, lon: 4.3525 };
const articles: Article[] = [
  { id: 1, title: "Brussels Town Hall", lat: 50.8467, lon: 4.3499, description: "Gothic town hall", thumbnail: "https://upload.wikimedia.org/hotel-de-ville.jpg" },
  { id: 2, title: "Manneken Pis", lat: 50.8450, lon: 4.3499, description: null, thumbnail: null },
  { id: 3, title: "Atomium", lat: 50.8949, lon: 4.3415, description: "Landmark", thumbnail: null },
];

describe("articleItems", () => {
  test("a landmark is something to see: Read opens the profile, Walk there comes after", () => {
    const [first] = articleItems(articles, AT, 1000);
    expect(first).toMatchObject({ kind: "see", title: "Brussels Town Hall", primary: { label: "Read" } });
    expect(first?.more?.map((a) => a.label)).toEqual(["Walk there"]);
  });

  test("nearest first, nothing beyond the radius, a fallback detail without description", () => {
    const items = articleItems(articles, AT, 1000);
    expect(items.map((i) => i.title)).toEqual(["Brussels Town Hall", "Manneken Pis"]);
    expect(items[1]?.detail).toBe("Wikipedia article");
  });
});
