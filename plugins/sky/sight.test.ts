import { expect, test } from "bun:test";
import { projectSight } from "./sight-projection";

test("projects the thing straight ahead at centre, east on the right and higher above", () => {
  const pose = { right: [1, 0, 0], up: [0, 0, 1], forward: [0, 1, 0] } as const;
  expect(projectSight(0, 0, pose, 400, 400)).toEqual({ x: 200, y: 200 });
  expect(projectSight(10, 0, pose, 400, 400)?.x).toBeGreaterThan(200);
  expect(projectSight(0, 10, pose, 400, 400)?.y).toBeLessThan(200);
  expect(projectSight(180, 0, pose, 400, 400)).toBeNull();
  expect(projectSight(90, 0, pose, 400, 400)).toBeNull();
});

test("finds a target across north and at the zenith", () => {
  const north = { right: [1, 0, 0], up: [0, 0, 1], forward: [0, 1, 0] } as const;
  const up = { right: [1, 0, 0], up: [0, -1, 0], forward: [0, 0, 1] } as const;
  expect(projectSight(359, 0, north, 375, 400)?.x).toBeLessThan(187.5);
  expect(projectSight(0, 90, up, 375, 400)?.y).toBeCloseTo(200);
});
