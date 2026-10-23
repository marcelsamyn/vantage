import { describe, expect, test } from "bun:test";
import { snapPoint } from "./orders.server";

describe("snapPoint", () => {
  test("callers in one 0.01 degree cell share one point", () => {
    expect(snapPoint({ lat: 50.8501, lon: 4.3512 })).toEqual(snapPoint({ lat: 50.8549, lon: 4.3548 }));
    expect(snapPoint({ lat: 50.8501, lon: 4.3512 })).toEqual({ lat: 50.85, lon: 4.35 });
  });

  test("a point in the next cell snaps elsewhere", () => {
    expect(snapPoint({ lat: 50.8551, lon: 4.3512 })).not.toEqual(snapPoint({ lat: 50.8549, lon: 4.3512 }));
  });

  test("is stable when applied twice", () => {
    const once = snapPoint({ lat: -33.8688, lon: 151.2093 });
    expect(snapPoint(once)).toEqual(once);
  });
});
