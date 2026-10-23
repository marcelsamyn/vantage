import { describe, expect, test } from "bun:test";
import { compassWords, edgePoint, layoutPips, perimeterOf, pipTrack, pointAtPerimeter, radiusForZoom, stablePipKeys, widerRadius, type PipSize, type Rect, type Side } from "./around";

// A phone's free map area: below the search bar, above the sheet.
const FRAME: Rect = { left: 8, top: 100, right: 385, bottom: 500 };
const MID = { x: 196.5, y: 300 };

describe("radiusForZoom", () => {
  test("is 1 km at the opening zoom and doubles per level out", () => {
    expect(radiusForZoom(16)).toBe(1000);
    expect(radiusForZoom(15)).toBe(2000);
    expect(radiusForZoom(17)).toBe(1000);
  });

  test("rounds to the nearest level, so a small pinch keeps the radius", () => {
    expect(radiusForZoom(16.4)).toBe(1000);
    expect(radiusForZoom(15.6)).toBe(1000);
    expect(radiusForZoom(15.4)).toBe(2000);
  });

  test("keeps nearby items within 1 km when zooming in, up to 8 km when zooming out", () => {
    expect(radiusForZoom(21)).toBe(1000);
    expect(radiusForZoom(3)).toBe(8000);
    expect(widerRadius(4000)).toBe(8000);
    expect(widerRadius(8000)).toBeNull();
  });
});

describe("edgePoint", () => {
  test("follows the line from the anchor to the edge it crosses", () => {
    expect(edgePoint(MID, { x: 196.5, y: -400 }, FRAME)).toMatchObject({ x: 196.5, y: 100, side: "top", angle: -90 });
    expect(edgePoint(MID, { x: 900, y: 300 }, FRAME)).toMatchObject({ x: 385, y: 300, side: "right", angle: 0 });
    // Steeply down and to the left: the bottom edge comes before the left one.
    const p = edgePoint(MID, { x: -3.5, y: 700 }, FRAME);
    expect(p.side).toBe("bottom");
    expect(p.y).toBe(500);
    expect(p.x).toBeCloseTo(96.5, 6);
    // At 45° down and to the left, the left edge comes first.
    expect(edgePoint(MID, { x: -103.5, y: 600 }, FRAME)).toMatchObject({ x: 8, side: "left" });
  });

  test("keeps the true direction when the anchor is off centre", () => {
    const you = { x: 100, y: 450 };
    const p = edgePoint(you, { x: 700, y: -150 }, FRAME);
    expect(p.side).toBe("right");
    expect(p.x).toBe(385);
    expect(p.y).toBeCloseTo(450 - 285, 6);
    expect(p.angle).toBeCloseTo(-45, 6);
  });

  test("maps to and from a distance along the edge", () => {
    for (const target of [{ x: 196, y: -1000 }, { x: 2000, y: 310 }, { x: 150, y: 2000 }, { x: -800, y: 260 }]) {
      const p = edgePoint(MID, target, FRAME);
      const back = pointAtPerimeter(perimeterOf(p, FRAME), FRAME);
      expect(back.side).toBe(p.side);
      expect(back.x).toBeCloseTo(p.x, 6);
      expect(back.y).toBeCloseTo(p.y, 6);
    }
    expect(pointAtPerimeter(-10, FRAME)).toEqual({ x: 8, y: 110, side: "left" });
  });
});

describe("layoutPips", () => {
  // As drawn: wide capsules on the top and bottom edges, narrow tags on the left and right ones.
  const CAPSULE = { w: 90, h: 32 };
  const TAG = { w: 52, h: 46 };
  const size = (side: Side): PipSize => (side === "top" || side === "bottom" ? CAPSULE : TAG);
  const track = pipTrack(FRAME, size);
  const whole = (p: { x: number; y: number; side: Side }): boolean => {
    const s = size(p.side);
    return p.x - s.w / 2 >= FRAME.left - 1e-9 && p.x + s.w / 2 <= FRAME.right + 1e-9 && p.y - s.h / 2 >= FRAME.top - 1e-9 && p.y + s.h / 2 <= FRAME.bottom + 1e-9;
  };

  test("pips far apart stay single and sit on the track", () => {
    const pips = layoutPips(
      [
        { key: "north", target: { x: 196, y: -500 }, distanceM: 600 },
        { key: "east", target: { x: 1200, y: 300 }, distanceM: 800 },
      ],
      MID,
      FRAME,
      size,
    );
    expect(pips.map((p) => p.members)).toEqual([["north"], ["east"]]);
    expect(pips[0]).toMatchObject({ side: "top", y: track.top });
    expect(pips[1]).toMatchObject({ side: "right", x: track.right, y: 300 });
  });

  test("pips that would overlap merge, nearest first, at their mean place on the edge", () => {
    const pips = layoutPips(
      [
        { key: "bike", target: { x: 230, y: -600 }, distanceM: 640 },
        { key: "bus", target: { x: 210, y: -600 }, distanceM: 420 },
        { key: "fountain", target: { x: 600, y: 300 }, distanceM: 300 },
      ],
      MID,
      FRAME,
      size,
    );
    expect(pips).toHaveLength(2);
    const top = pips.find((p) => p.side === "top");
    expect(top?.members).toEqual(["bus", "bike"]);
    // Halfway between where the lines to the bus (199.3) and the bike (203.4) cross the track.
    expect(top?.x).toBeCloseTo(201.4, 0);
    expect(top?.angle).toBeLessThan(-80);
  });

  test("a merge that moves a pip onto its neighbour merges again", () => {
    // Three pips 50 px apart on the top edge: no pair is a capsule apart, so all three become one.
    const xs = [100, 150, 200];
    const inputs = xs.map((x, i) => ({ key: `p${i}`, target: { x: MID.x + (x - MID.x) * 10, y: MID.y - 2000 }, distanceM: 500 + i }));
    const pips = layoutPips(inputs, MID, FRAME, size);
    expect(pips).toHaveLength(1);
    expect(pips[0]?.members).toEqual(["p0", "p1", "p2"]);
  });

  test("merges across the top-left corner and keeps the pip whole", () => {
    const pips = layoutPips(
      [
        { key: "top-corner", target: { x: 50, y: 50 }, distanceM: 400 },
        { key: "left-corner", target: { x: 0, y: 125 }, distanceM: 350 },
      ],
      { x: 60, y: 140 },
      FRAME,
      size,
    );
    expect(pips).toHaveLength(1);
    expect(pips[0]?.members).toEqual(["left-corner", "top-corner"]);
    expect(pips[0]?.x).toBeLessThan(60);
    expect(pips[0]?.y).toBeLessThan(130);
    expect(pips[0] && whole(pips[0])).toBe(true);
  });

  test("a capsule near a corner slides along its edge to stay whole", () => {
    const [pip] = layoutPips([{ key: "far-corner", target: { x: 3800, y: -4000 }, distanceM: 900 }], MID, FRAME, size);
    expect(pip?.side).toBe("top");
    expect(pip?.x).toBe(FRAME.right - CAPSULE.w / 2);
  });

  test("an anchor outside the track counts from the frame's centre", () => {
    const [pip] = layoutPips([{ key: "north", target: { x: (FRAME.left + FRAME.right) / 2, y: -900 }, distanceM: 500 }], { x: -300, y: 2000 }, FRAME, size);
    expect(pip?.side).toBe("top");
    expect(pip?.x).toBeCloseTo((FRAME.left + FRAME.right) / 2, 6);
  });

  test("the selection leads its pip", () => {
    const pips = layoutPips(
      [
        { key: "near", target: { x: 200, y: -600 }, distanceM: 200 },
        { key: "chosen", target: { x: 205, y: -600 }, distanceM: 900 },
      ],
      MID,
      FRAME,
      size,
      "chosen",
    );
    expect(pips[0]?.members).toEqual(["chosen", "near"]);
  });

  test("a crowded frame never yields overlapping pips, and every pip is whole", () => {
    const inputs = Array.from({ length: 40 }, (_, i) => {
      const a = (i / 40) * 2 * Math.PI;
      return { key: `k${i}`, target: { x: MID.x + Math.cos(a) * 3000, y: MID.y + Math.sin(a) * 3000 }, distanceM: 300 + i };
    });
    const pips = layoutPips(inputs, MID, FRAME, size);
    expect(pips.flatMap((p) => p.members).sort()).toEqual(inputs.map((i) => i.key).sort());
    for (const [i, a] of pips.entries()) {
      expect(whole(a)).toBe(true);
      for (const b of pips.slice(i + 1)) {
        const sa = size(a.side);
        const sb = size(b.side);
        expect(Math.abs(a.x - b.x) >= (sa.w + sb.w) / 2 || Math.abs(a.y - b.y) >= (sa.h + sb.h) / 2).toBe(true);
      }
    }
  });
});

test("compassWords names eight directions", () => {
  expect(compassWords(0)).toBe("north");
  expect(compassWords(44)).toBe("north-east");
  expect(compassWords(181)).toBe("south");
  expect(compassWords(-90)).toBe("west");
  expect(compassWords(338)).toBe("north");
});

describe("stablePipKeys", () => {
  test("a pip keeps its key when another merges into it, even if the newcomer leads", () => {
    expect(stablePipKeys([{ members: ["bus", "bike"] }], ["bike"], null)).toEqual(["bike"]);
  });

  test("the focused pip keeps its key through a merge", () => {
    expect(stablePipKeys([{ members: ["bus", "bike", "cam"] }], ["bus", "cam"], "cam")).toEqual(["cam"]);
  });

  test("a split gives the old key to one pip and a member's key to the other", () => {
    expect(stablePipKeys([{ members: ["bus"] }, { members: ["bike"] }], ["bike"], null)).toEqual(["bus", "bike"]);
  });

  test("each pip keeps its own old key when neighbours regroup", () => {
    // Before: pips "a" and "c". After: "b" joined the first pip and leads it, "d" joined the second.
    expect(stablePipKeys([{ members: ["b", "a"] }, { members: ["d", "c"] }], ["a", "c"], "c")).toEqual(["a", "c"]);
  });
});
