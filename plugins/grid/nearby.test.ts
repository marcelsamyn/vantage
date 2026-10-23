import { describe, expect, test } from "bun:test";
import { cameraItems } from "./nearby";
import type { GridFeature, GridKind } from "./types";

const AT = { lat: 50.8467, lon: 4.3525 };

const feature = (osm: string, kind: GridKind, lon: number, lat: number, tags: Record<string, string> = {}, directions: number[] = []): GridFeature => ({
  type: "Feature",
  geometry: { type: "Point", coordinates: [lon, lat] },
  properties: { kind, osm, name: null, tags, web: null, directions, ids: [] },
});

describe("cameraItems", () => {
  const features = [
    feature("node/1", "camera", 4.3545, 50.8471),
    feature("node/2", "camera", 4.3527, 50.8468, { operator: "Ville de Bruxelles" }, [90, 270]),
    feature("node/3", "water", 4.3526, 50.8467),
    feature("node/4", "camera", 4.3535, 50.8469),
    feature("node/5", "camera", 4.3532, 50.8466),
  ];

  test("lists the nearest three cameras and nothing else", () => {
    const items = cameraItems(features, AT, 500);
    expect(items.map((i) => i.id)).toEqual(["node/2", "node/5", "node/4"]);
    expect(items.every((i) => i.kind === "see" && i.tone === "alarm")).toBe(true);
  });

  test("says who runs it and which way it looks", () => {
    expect(cameraItems(features, AT, 500)[0]).toMatchObject({ title: "Surveillance camera", detail: "Ville de Bruxelles · watching E, W" });
  });

  test("an unknown camera still says what it is", () => {
    expect(cameraItems([feature("node/9", "camera", 4.3526, 50.8467)], AT, 500)[0]?.detail).toBe("Surveillance camera");
  });

  test("nothing beyond the reach", () => {
    expect(cameraItems(features, { lat: 50.9, lon: 4.5 }, 500)).toEqual([]);
  });
});
