import { describe, expect, test } from "bun:test";
import { destination } from "../../shared/geo";
import { publicPicture } from "./items";
import type { Webcam } from "./types";

/** A TfL junction camera mapped in OpenStreetMap as node/42. */
const AT = { lat: 51.5081, lon: -0.1281 };
const camera = (id: string, metresAway: number): Webcam => ({
  id,
  provider: id.split(":")[0] ?? "tfl",
  providerName: "Transport for London",
  kind: "traffic",
  name: `Camera ${id}`,
  ...destination(AT, 90, metresAway),
  image: `https://cams.example/${id}.jpg`,
  video: null,
  stream: null,
  direction: null,
  bearing: null,
  refreshS: 300,
  license: "Open data",
  page: null,
  tz: null,
  frames: 1,
  capturedAt: null,
});

describe("publicPicture", () => {
  test("shows the nearest public camera within 30 m, named by its distance", () => {
    const pick = publicPicture([camera("windy:1", 26), camera("tfl:2", 12), camera("tfl:3", 80)], AT, "node/42");
    expect(pick?.camera.id).toBe("tfl:2");
    expect(pick?.same).toBe(false);
    expect(pick?.distanceM).toBeCloseTo(12, 0);
  });

  test("says nothing when every public camera stands further than 30 m away", () => {
    expect(publicPicture([camera("tfl:3", 31), camera("windy:4", 200)], AT, "node/42")).toBeNull();
  });

  test("prefers the camera's own picture, however far its two records put it", () => {
    const pick = publicPicture([camera("tfl:2", 5), camera("osm:node/42", 60)], AT, "node/42");
    expect(pick?.camera.id).toBe("osm:node/42");
    expect(pick?.same).toBe(true);
  });

  test("does not take another OpenStreetMap object for this one", () => {
    expect(publicPicture([camera("osm:node/420", 40)], AT, "node/42")).toBeNull();
  });
});
