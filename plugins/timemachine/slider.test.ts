import { expect, test } from "bun:test";
import { EDGE, splitForKey, splitText } from "./slider";

test("Home and End stop at the clamped edges", () => {
  expect(splitForKey("Home", 0.5)).toBe(EDGE);
  expect(splitForKey("End", 0.5)).toBe(1 - EDGE);
});

test("arrows step by 2 points and pages by 10, never past the edges", () => {
  expect(splitForKey("ArrowRight", 0.5)).toBeCloseTo(0.52);
  expect(splitForKey("PageDown", 0.5)).toBeCloseTo(0.4);
  expect(splitForKey("PageUp", 0.95)).toBe(1 - EDGE);
  expect(splitForKey("ArrowLeft", 0.05)).toBe(EDGE);
});

test("other keys are ignored", () => {
  expect(splitForKey("Tab", 0.5)).toBeNull();
});

test("the spoken value gives both shares", () => {
  expect(splitText(0.62)).toBe("62 % then, 38 % now");
});
