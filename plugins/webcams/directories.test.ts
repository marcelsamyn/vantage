import { describe, expect, test } from "bun:test";
import type { OsmElement } from "../grid/overpass.server";
import { osmCameras, tilesAround, windyCameras, type WindyAnswer } from "./directories.server";
import recorded from "./fixtures/windy-brussels.json";

describe("windyCameras", () => {
  const cameras = windyCameras(recorded satisfies WindyAnswer);

  test("keeps active cameras and skips inactive ones", () => {
    expect(cameras.map((c) => c.id)).toEqual(["windy:1736585384", "windy:1761136786", "windy:1609417481"]);
  });

  test("splits the title into place, direction and label", () => {
    expect(cameras.map((c) => [c.name, c.direction])).toEqual([
      ["City of Brussels · Place De Brouckère", "north"],
      ["City of Brussels · Grand Place", null],
      ["Beersel", "west"],
    ]);
  });

  test("links every picture to its Windy page and credits Windy", () => {
    expect(cameras[0]).toMatchObject({ kind: "view", page: "https://windy.com/webcams/1736585384", license: "Webcams provided by Windy.com", capturedAt: Date.parse("2026-10-10T06:34:01.000Z") });
    expect(cameras[0]?.image).toStartWith("https://imgproxy.windy.com/_/preview/");
  });
});

describe("osmCameras", () => {
  const node = (id: number, tags: Record<string, string>): OsmElement => ({ type: "node", id, lat: 59.437, lon: 24.745, tags });

  test("keeps a camera only when its webcam tag points at a picture", () => {
    const cameras = osmCameras([
      node(1, { "contact:webcam": "https://ristmikud.tallinn.ee/last/cam106.jpg", name: "Viru ring", operator: "Tallinn Transport", "camera:direction": "90", "surveillance:zone": "traffic" }),
      node(2, { "contact:webcam": "https://trafficmap.example.gov/" }),
      node(3, { "contact:webcam": "https://web.archive.org/web/2026/https://example.org/p/1.jpg" }),
      node(4, { "contact:webcam": "javascript:alert(1).jpg" }),
    ]);
    expect(cameras).toHaveLength(1);
    expect(cameras[0]).toMatchObject({ id: "osm:node/1", name: "Viru ring", providerName: "Tallinn Transport", kind: "traffic", direction: "E", page: "https://www.openstreetmap.org/node/1" });
  });

  test("preserves precise OSM orientation for the map", () => {
    const [camera] = osmCameras([node(10, { "contact:webcam": "https://example.org/a.jpg", "camera:direction": "123.4" })]);
    expect(camera?.bearing).toBe(123.4);
  });

  test("takes the first picture from a list and names the camera after the picture's site when OSM has no name", () => {
    const [camera] = osmCameras([node(5, { "contact:webcam": "https://example.org/live ; https://cams.example.org/now.JPG" })]);
    expect(camera).toMatchObject({ image: "https://cams.example.org/now.JPG", name: "Camera of cams.example.org", providerName: "cams.example.org", kind: "view" });
  });

  test("places a way at the centre Overpass computed", () => {
    const [camera] = osmCameras([{ type: "way", id: 7, center: { lat: 46.1, lon: 7.2 }, tags: { "contact:webcam": "https://example.org/a.png" } }]);
    expect(camera).toMatchObject({ lat: 46.1, lon: 7.2 });
  });
});

describe("tilesAround", () => {
  test("a small circle inside one degree asks for one tile", () => {
    expect(tilesAround({ lat: 50.5, lon: 4.5, radiusM: 5_000 })).toEqual([{ s: 50, w: 4 }]);
  });

  test("a circle across tile edges asks for each tile it touches, the tile it sits in first", () => {
    const tiles = tilesAround({ lat: 50.9, lon: 4.95, radiusM: 30_000 });
    expect(tiles).toHaveLength(4);
    expect(tiles[0]).toEqual({ s: 50, w: 4 });
  });

  test("wraps around the antimeridian and caps the number of tiles", () => {
    expect(tilesAround({ lat: 0, lon: 179.9, radiusM: 20_000 }).map((t) => t.w).sort()).toEqual([-180, -180, 179, 179]);
    expect(tilesAround({ lat: 45, lon: 7, radiusM: 400_000 })).toHaveLength(12);
  });
});
