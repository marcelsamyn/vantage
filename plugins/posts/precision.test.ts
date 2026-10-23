import { describe, expect, test } from "bun:test";
import { isApproximate } from "./precision";
import { inatPage, sightingsFrom } from "./sources/inaturalist.server";

const raw: unknown = await Bun.file(new URL("./fixtures/inaturalist.json", import.meta.url)).json();
const NOW = Date.parse("2026-10-09T07:00:00+02:00");
const posts = sightingsFrom(inatPage.parse(raw), NOW);

describe("which sightings are drawn as areas", () => {
  test("every obscured or hidden-position post in the recording is an area, never a dot or photo pin", () => {
    const flagged = posts.filter((p) => p.detail.approximate);
    expect(flagged.length).toBeGreaterThan(0);
    for (const p of flagged) expect(isApproximate(p)).toBe(true);
  });

  test("a stated accuracy wider than 1 km makes an area even when nothing is obscured", () => {
    const exact = posts.find((p) => !p.detail.approximate);
    if (!exact) throw new Error("fixture has no exact post");
    expect(isApproximate({ ...exact, uncertaintyM: null })).toBe(false);
    expect(isApproximate({ ...exact, uncertaintyM: 1_000 })).toBe(false);
    expect(isApproximate({ ...exact, uncertaintyM: 1_001 })).toBe(true);
  });
});
