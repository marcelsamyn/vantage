import { describe, expect, test } from "bun:test";
import { featureDistance, INSIDE_AREA_PX, nearestHit, tapDistance, type ScreenShape } from "./hit";

const TAP = { x: 100, y: 100 };

describe("tapDistance", () => {
  test("a point: straight-line distance to the nearest of its points", () => {
    expect(tapDistance(TAP, { type: "points", points: [{ x: 112, y: 105 }] })).toBe(13);
    expect(tapDistance(TAP, { type: "points", points: [{ x: 300, y: 300 }, { x: 103, y: 104 }] })).toBe(5);
  });

  test("a line: distance to its nearest segment, not its nearest vertex", () => {
    const road: ScreenShape = { type: "lines", lines: [[{ x: 0, y: 110 }, { x: 400, y: 110 }]] };
    expect(tapDistance(TAP, road)).toBe(10);
  });

  test("an area counts only when the tap is inside it, and as further than anything the tap reached", () => {
    const square: ScreenShape = { type: "areas", rings: [[{ x: 50, y: 50 }, { x: 150, y: 50 }, { x: 150, y: 150 }, { x: 50, y: 150 }, { x: 50, y: 50 }]] };
    expect(tapDistance(TAP, square)).toBe(INSIDE_AREA_PX);
    expect(tapDistance({ x: 160, y: 100 }, square)).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("featureDistance", () => {
  // The area as projected for the first copy of the world; the click landed on the copy drawn beside it.
  const elsewhere: ScreenShape = { type: "areas", rings: [[{ x: 900, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 100 }, { x: 900, y: 0 }]] };

  test("a feature the map found under a click's exact point is hit, whatever its geometry says", () => {
    expect(featureDistance(TAP, elsewhere, true)).toBe(INSIDE_AREA_PX);
    expect(featureDistance(TAP, { type: "points", points: [] }, true)).toBe(INSIDE_AREA_PX);
  });

  test("a touch measures: an area the fingertip is not inside stays out of reach", () => {
    expect(featureDistance(TAP, elsewhere, false)).toBe(Number.POSITIVE_INFINITY);
    expect(featureDistance(TAP, { type: "points", points: [{ x: 110, y: 100 }] }, false)).toBe(10);
  });
});

describe("nearestHit", () => {
  test("a tap between a stop and a bus opens the one nearer the finger", () => {
    const hit = nearestHit([
      { item: "stop", distance: tapDistance(TAP, { type: "points", points: [{ x: 88, y: 92 }] }) },
      { item: "bus", distance: tapDistance(TAP, { type: "points", points: [{ x: 106, y: 103 }] }) },
    ]);
    expect(hit).toBe("bus");
  });

  test("a small node beside the finger wins over the zone the finger is in", () => {
    const zone: ScreenShape = { type: "areas", rings: [[{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 400 }, { x: 0, y: 0 }]] };
    const inZone = tapDistance({ x: 300, y: 100 }, zone);
    expect(nearestHit([{ item: "zone", distance: inZone }, { item: "node", distance: 14 }])).toBe("node");
    expect(nearestHit([{ item: "zone", distance: inZone }])).toBe("zone");
  });

  test("nothing reached: no hit, so a tap on empty map stays empty", () => {
    expect(nearestHit([])).toBeNull();
    expect(nearestHit([{ item: "beside an area", distance: Number.POSITIVE_INFINITY }])).toBeNull();
  });

  test("on equal distance the first, drawn on top, wins", () => {
    expect(nearestHit([{ item: "top", distance: 4 }, { item: "below", distance: 4 }])).toBe("top");
  });
});
