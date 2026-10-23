import { describe, expect, test } from "bun:test";
import { webcam, type Operator } from "./camera.server";
import { staggerSlot } from "./items";

const OPERATOR: Operator = { provider: "test", providerName: "Test Roads", kind: "traffic", license: "Open data", refreshS: 60 };
const BASE = { id: "1", name: " Bridge ", lat: 51.5, lon: -0.1 };

describe("webcam", () => {
  test("keeps numeric and compass bearings without guessing from descriptions", () => {
    for (const [direction, bearing] of [["0", 0], ["123.4", 123.4], ["360", 0], ["North", 0], ["north-east", 45], ["WSW", 247.5], ["Westbound", 270], ["SOUTH-York Road", 180], ["North-East-River", 45], ["East (twds Blackfriars Bridge)", 90], ["towards bridge", null], ["", null], ["90;180", null], ["9".repeat(400), null]] as const) {
      expect(webcam(OPERATOR, { ...BASE, image: "https://cams.example/1.jpg", direction })[0]?.bearing).toBe(bearing);
    }
  });

  test("keeps an https or http picture address", () => {
    expect(webcam(OPERATOR, { ...BASE, image: "https://cams.example/1.jpg" })[0]?.image).toBe("https://cams.example/1.jpg");
    expect(webcam(OPERATOR, { ...BASE, image: "http://cams.example/1.jpg" })).toHaveLength(1);
  });

  test("drops a camera whose picture is not a web address", () => {
    for (const image of ["javascript:alert(1)", "data:image/svg+xml,<svg/>", "file:///etc/passwd", "//cams.example/1.jpg", "not a url", ""]) {
      expect(webcam(OPERATOR, { ...BASE, image })).toEqual([]);
    }
  });

  test("clears a video clip and a stream that are not web addresses, but keeps the camera", () => {
    const [cam] = webcam(OPERATOR, {
      ...BASE,
      image: "https://cams.example/1.jpg",
      video: "javascript:alert(1)",
      stream: { type: "hls", url: "data:application/x-mpegurl,#EXTM3U" },
    });
    expect(cam?.video).toBeNull();
    expect(cam?.stream).toBeNull();
  });

  test("keeps a valid video clip and stream", () => {
    const stream = { type: "hls", url: "https://cams.example/live.m3u8" } as const;
    const [cam] = webcam(OPERATOR, { ...BASE, image: "https://cams.example/1.jpg", video: "https://cams.example/clip.mp4", stream });
    expect(cam?.video).toBe("https://cams.example/clip.mp4");
    expect(cam?.stream).toEqual(stream);
  });
});

describe("staggerSlot", () => {
  test("depends on the key only and stays inside the slot range", () => {
    const keys = ["a:1", "a:2", "noaa:41001", "tfl:JamCams_00001.01251", "x"];
    for (const key of keys) {
      const slot = staggerSlot(key, 12);
      expect(slot).toBeGreaterThanOrEqual(0);
      expect(slot).toBeLessThan(12);
      expect(staggerSlot(key, 12)).toBe(slot);
    }
    expect(new Set(keys.map((k) => staggerSlot(k, 12))).size).toBeGreaterThan(1);
  });
});
