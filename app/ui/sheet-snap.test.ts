import { describe, expect, test } from "bun:test";
import { FLICK_PX_PER_MS, nextSnap, resist, settleAt, snapOffset, type SheetMetrics, type SnapPoint, type Stop } from "./sheet-snap";

// The "Around me" drawer on a 393 × 852 phone: 640 px of room, a full-height panel, a 170 px peek.
const DRAWER: SheetMetrics = { height: 640, room: 640, peek: 170 };
const stops = (m: SheetMetrics, snaps: readonly SnapPoint[]): Stop<SnapPoint>[] => snaps.map((id) => ({ id, y: snapOffset(id, m) }));
const DRAWER_STOPS = stops(DRAWER, ["peek", "half", "full"]);

describe("snapOffset", () => {
  test("full shows the whole panel, half shows half the room, peek shows the header and a row", () => {
    expect(snapOffset("full", DRAWER)).toBe(0);
    expect(snapOffset("half", DRAWER)).toBe(320);
    expect(snapOffset("peek", DRAWER)).toBe(470);
  });

  test("a sheet shorter than half the room rests fully up at every snap", () => {
    const short: SheetMetrics = { height: 220, room: 640, peek: 170 };
    expect(snapOffset("half", short)).toBe(0);
    expect(snapOffset("peek", short)).toBe(50);
  });
});

describe("settleAt", () => {
  test("a slow release goes to the nearest stop", () => {
    expect(settleAt(DRAWER_STOPS, 300, 0)).toBe("half");
    expect(settleAt(DRAWER_STOPS, 120, 0.1)).toBe("full");
    expect(settleAt(DRAWER_STOPS, 430, -0.2)).toBe("peek");
  });

  test("a flick moves on one stop in its direction, even when released next to the stop it left", () => {
    // From the peek, a short quick swipe up: 30 px moved, still nearest to the peek.
    expect(settleAt(DRAWER_STOPS, 440, -FLICK_PX_PER_MS)).toBe("half");
    // From full, a quick swipe down goes to half, not all the way to the peek.
    expect(settleAt(DRAWER_STOPS, 40, 2.5)).toBe("half");
    expect(settleAt(DRAWER_STOPS, 330, 1)).toBe("peek");
  });

  test("a flick past the last stop settles on it", () => {
    expect(settleAt(DRAWER_STOPS, 490, 1.2)).toBe("peek");
    expect(settleAt(DRAWER_STOPS, -12, -1.2)).toBe("full");
  });

  test("a modal sheet closes on a flick down from its lowest stop", () => {
    const profile: SheetMetrics = { height: 640, room: 640, peek: 0 };
    const modal: Stop<SnapPoint | "closed">[] = [...stops(profile, ["half", "full"]), { id: "closed", y: 640 }];
    expect(settleAt(modal, 360, 0.9)).toBe("closed");
    expect(settleAt(modal, 360, 0)).toBe("half");
    expect(settleAt(modal, 560, 0)).toBe("closed");
  });
});

test("the handle cycles up through the snaps and back to the smallest", () => {
  expect(nextSnap(["peek", "half", "full"], "peek")).toBe("half");
  expect(nextSnap(["full", "half", "peek"], "half")).toBe("full");
  expect(nextSnap(["peek", "half", "full"], "full")).toBe("peek");
  expect(nextSnap(["half", "full"], "full")).toBe("half");
});

test("a drag past an end stop moves a quarter as far", () => {
  expect(resist(-40, 0, 470)).toBe(-10);
  expect(resist(510, 0, 470)).toBe(480);
  expect(resist(200, 0, 470)).toBe(200);
});
