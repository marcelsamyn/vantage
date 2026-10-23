import { describe, expect, test } from "bun:test";
import { splitAtDateline } from "./track";

describe("splitAtDateline", () => {
  test("a path that stays on one side is one line", () => {
    expect(splitAtDateline([{ lat: 0, lon: 10 }, { lat: 1, lon: 20 }])).toEqual([[[10, 0], [20, 1]]]);
  });

  test("an eastward path is cut on the date line at the crossing latitude", () => {
    const lines = splitAtDateline([{ lat: 10, lon: 170 }, { lat: 20, lon: -170 }, { lat: 20, lon: -160 }]);
    expect(lines).toEqual([
      [[170, 10], [180, 15]],
      [[-180, 15], [-170, 20], [-160, 20]],
    ]);
  });

  test("a westward path is cut the other way, and several crossings make several cuts", () => {
    const lines = splitAtDateline([{ lat: 0, lon: -179 }, { lat: 0, lon: 179 }, { lat: 0, lon: -179 }]);
    expect(lines).toHaveLength(3);
    expect(lines[0]?.at(-1)).toEqual([-180, 0]);
    expect(lines[1]).toEqual([[180, 0], [179, 0], [180, 0]]);
    expect(lines[2]?.[0]).toEqual([-180, 0]);
  });

  test("a single fix draws nothing", () => {
    expect(splitAtDateline([{ lat: 0, lon: 0 }])).toEqual([]);
  });
});
