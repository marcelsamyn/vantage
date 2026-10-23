import { describe, expect, test } from "bun:test";
import { cameraFrame, lensMarkers } from "./projection";

type PlacedItem = Parameters<typeof lensMarkers>[0][number];
const pose = { right: [1, 0, 0], up: [0, 0, 1], forward: [0, 1, 0] } as const;
const item = (id: string, bearing: number, distanceM = 100): PlacedItem => ({
  id, key: `places.nearby:${id}`, source: "places.nearby", title: id, detail: "Landmark", kind: "see", at: { lat: 0.001, lon: 0 }, icon: [], tone: "fog",
  bearing, distanceM, urgency: "none",
  entity: { kind: "place", id, data: { lat: 0.001, lon: 0, name: id, context: "Test city", area: "Test area", kind: "landmark", countryCode: null } }, primary: { label: "Open", run: () => undefined },
});
const frame = cameraFrame(375, 500, 1280, 720);

describe("Lens direction markers", () => {
  test("matches the letterboxed camera and rejects unready dimensions", () => {
    expect(frame.width).toBe(375);
    expect(frame.height).toBeCloseTo(210.9375);
    expect(frame.top).toBeCloseTo(144.53125);
    expect(cameraFrame(375, 500, 0, 0).width).toBe(0);
    expect(lensMarkers([item("north", 0)], pose, cameraFrame(0, 0, 1, 1), 0)).toEqual([]);
  });

  test("shows the target ahead, drops the one behind, and centres inside the picture", () => {
    const markers = lensMarkers([item("ahead", 0), item("behind", 180)], pose, frame, 0);
    expect(markers.map((m) => m.item.id)).toEqual(["ahead"]);
    expect(markers[0]?.x).toBeCloseTo(187.5);
    expect(markers[0]?.y).toBeCloseTo(250);
  });

  test("keeps the nearest overlapping label and leaves the input list intact", () => {
    const items = [item("near", 0, 100), item("far", 0, 400)];
    expect(lensMarkers(items, pose, frame, 0).map((m) => m.item.id)).toEqual(["near"]);
    expect(items).toHaveLength(2);
  });

  test("correction moves markers across north and can put them outside the view", () => {
    const items = [item("north", 0)];
    expect(lensMarkers(items, pose, frame, -10)[0]?.x).toBeLessThan(187.5);
    expect(lensMarkers(items, pose, frame, 10)[0]?.x).toBeGreaterThan(187.5);
    expect(lensMarkers(items, pose, frame, 100)).toEqual([]);
  });

  test("does not invent profiles or ground bearings for overhead records", () => {
    const noProfile = item("no-profile", 0);
    delete noProfile.entity;
    const overhead = { ...item("overhead", 0), at: "overhead", bearing: null } satisfies PlacedItem;
    expect(lensMarkers([noProfile, overhead], pose, frame, 0)).toEqual([]);
  });

  test("works after rotating the phone to landscape", () => {
    const landscape = { right: [0, 0, -1], up: [1, 0, 0], forward: [0, 1, 0] } as const;
    const markers = lensMarkers([item("north", 0)], landscape, cameraFrame(640, 360, 1280, 720), 0);
    expect(markers[0]?.x).toBeCloseTo(320);
    expect(markers[0]?.y).toBeCloseTo(180);
  });
});
