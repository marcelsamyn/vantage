import { expect, test } from "bun:test";
import { freshness } from "./api";

const HOUR = 3_600_000;

test("a kept set answers at once for three days, and is refreshed in the background after six hours", () => {
  expect(freshness(1 * HOUR)).toEqual({ usable: true, stale: false });
  expect(freshness(7 * HOUR)).toEqual({ usable: true, stale: true });
  expect(freshness(71 * HOUR)).toEqual({ usable: true, stale: true });
  // Older than three days: the request waits for a download, as for a missing set.
  expect(freshness(73 * HOUR)).toEqual({ usable: false, stale: true });
});
