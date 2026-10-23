import { describe, expect, test } from "bun:test";
import { cameraItems } from "./nearby";
import type { Webcam } from "./types";

const AT = { lat: 50.8467, lon: 4.3525 };
const camera = (id: string, name: string, lat: number, lon: number, stream: Webcam["stream"] = null): Webcam => ({
  id,
  provider: "brussels",
  providerName: "Brussels Mobility",
  kind: "traffic",
  name,
  lat,
  lon,
  image: `https://cams.example/${id}.jpg`,
  video: null,
  stream,
  direction: "north",
  bearing: 0,
  refreshS: 60,
  license: "Open data",
  page: null,
  tz: null,
  frames: 1,
  capturedAt: null,
});

describe("cameraItems", () => {
  const cameras = [
    camera("brussels:2", "Boulevard Anspach", 50.8472, 4.3530),
    camera("brussels:1", "Place de la Bourse", 50.8468, 4.3526, { type: "hls", url: "https://cams.example/1.m3u8" }),
    camera("brussels:3", "Far away", 50.9, 4.5),
  ];

  test("a camera is something to look at: Watch opens it", () => {
    const [first] = cameraItems(cameras, AT, 1000);
    expect(first).toMatchObject({ kind: "see", title: "Place de la Bourse", live: true, primary: { label: "Watch" }, detail: expect.stringContaining("live video") });
    expect(first?.more?.map((a) => a.label)).toEqual(["Camera wall"]);
  });

  test("the nearest two within the radius, nearest first", () => {
    expect(cameraItems(cameras, AT, 1000).map((i) => i.title)).toEqual(["Place de la Bourse", "Boulevard Anspach"]);
    expect(cameraItems(cameras, AT, 20)).toHaveLength(1);
  });
});
