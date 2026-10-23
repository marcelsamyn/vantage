import { describe, expect, test } from "bun:test";
import { webcam, type Operator } from "./camera.server";
import { camerasAround, covering, fuse, type ListedProvider, type SearchedProvider } from "./providers.server";
import type { Webcam } from "./types";

const op = (provider: string): Operator => ({ provider, providerName: provider, kind: "traffic", license: "Open data", refreshS: 60 });
const cam = (provider: string, id: string, image: string, lat = 50.85, lon = 4.35): Webcam => {
  const [c] = webcam(op(provider), { id, name: id, lat, lon, image });
  if (!c) throw new Error("test camera is invalid");
  return c;
};

describe("fuse", () => {
  test("merges every answer and names the providers that failed", () => {
    const fused = fuse([{ name: "Roads" }, { name: "Windy.com" }, { name: "OpenStreetMap" }], [
      { status: "fulfilled", value: [cam("roads", "1", "https://roads.example/1.jpg")] },
      { status: "rejected", reason: new Error("down") },
      { status: "fulfilled", value: [cam("osm", "node/9", "https://cams.example/9.jpg")] },
    ]);
    expect(fused.cameras.map((c) => c.id)).toEqual(["roads:1", "osm:node/9"]);
    expect(fused.failed).toEqual(["Windy.com"]);
  });

  test("one picture listed by two providers is one camera, from the provider listed first", () => {
    const fused = fuse([{ name: "Roads" }, { name: "OpenStreetMap" }], [
      { status: "fulfilled", value: [cam("roads", "1", "https://ROADS.example/cams/1.jpg?size=m")] },
      { status: "fulfilled", value: [cam("osm", "node/9", "http://roads.example/cams/1.jpg?size=m"), cam("osm", "node/10", "https://roads.example/cams/1.jpg?size=l")] },
    ]);
    expect(fused.cameras.map((c) => c.id)).toEqual(["roads:1", "osm:node/10"]);
  });

  test("a camera a feed lists twice is kept once", () => {
    const twice = cam("roads", "1", "https://roads.example/1.jpg");
    expect(fuse([{ name: "Roads" }], [{ status: "fulfilled", value: [twice, twice] }]).cameras).toHaveLength(1);
  });
});

describe("covering and camerasAround", () => {
  const BRUSSELS = { lat: 50.85, lon: 4.35, radiusM: 10_000 };
  const london: ListedProvider = { id: "tfl", name: "TfL", bbox: [51.25, -0.6, 51.75, 0.35], load: async () => [] };
  const listed: ListedProvider = {
    id: "roads",
    name: "Roads",
    bbox: [50, 4, 51, 5],
    load: async () => [cam("roads", "near", "https://roads.example/1.jpg", 50.86, 4.36), cam("roads", "far", "https://roads.example/2.jpg", 50.5, 4.9)],
  };
  const searched = (configured: boolean): SearchedProvider => ({ id: "dir", name: "Directory", bbox: [-90, -180, 90, 180], configured: () => configured, search: async () => [] });

  test("asks only providers that cover the circle and are configured", () => {
    expect(covering([london, listed, searched(true), searched(false)], BRUSSELS).map((p) => p.name)).toEqual(["Roads", "Directory"]);
  });

  test("keeps only cameras inside the circle, whatever the provider returns", async () => {
    expect((await camerasAround(listed, BRUSSELS)).map((c) => c.id)).toEqual(["roads:near"]);
  });

  test("hands a searched provider the circle", async () => {
    let asked = null as unknown;
    const dir: SearchedProvider = { ...searched(true), search: async (around) => ((asked = around), []) };
    await camerasAround(dir, BRUSSELS);
    expect(asked).toEqual(BRUSSELS);
  });
});
