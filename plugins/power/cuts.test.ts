import { expect, test } from "bun:test";
import { amsterdamTime } from "./cuts.server";

test("Liander's local clock is read as Amsterdam summer time in October and winter time in January", () => {
  expect(amsterdamTime("2026-10-08T13:34:00")).toBe(Date.parse("2026-10-08T11:34:00Z") / 1000);
  expect(amsterdamTime("2026-01-15T13:34:00")).toBe(Date.parse("2026-01-15T12:34:00Z") / 1000);
});

test("the 1970 placeholder for 'not set' reads as no time", () => {
  expect(amsterdamTime("1970-01-01T00:00:00")).toBeNull();
});
