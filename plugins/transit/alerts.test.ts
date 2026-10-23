import { describe, expect, test } from "bun:test";
import { HttpError } from "../../server/kit";
import { pauseFor } from "./bmc.server";
import { isNews } from "./client";
import type { TransitAlert } from "./types";

const NOW = Date.parse("2026-10-11T08:00:00Z");
const DAY = 86_400_000;

describe("isNews", () => {
  const alert = (from: number | null, severity: TransitAlert["severity"] = "alarm"): TransitAlert => ({ id: "a", operator: "Atac", title: "Line suspended", text: "", routes: [], stops: [], severity, from, until: null, link: null });

  test("a closure that began months ago is not news, even when it stops a line", () => {
    expect(isNews(alert(NOW - 90 * DAY), NOW)).toBe(false);
  });

  test("a change from the last few days is news, and so is one still to come", () => {
    expect(isNews(alert(NOW - DAY, "sodium"), NOW)).toBe(true);
    expect(isNews(alert(NOW + DAY), NOW)).toBe(true);
    expect(isNews(alert(null), NOW)).toBe(false);
  });
});

describe("pauseFor", () => {
  test("waits as long as the portal asks, a minute when it does not say, an hour for a refused key, and briefly otherwise", () => {
    expect(pauseFor(new HttpError(503, "upstream_rate_limited", "STIB is rate limiting requests; retry in 21 s"))).toBe(21_000);
    expect(pauseFor(new HttpError(503, "upstream_rate_limited", "STIB is rate limiting requests"))).toBe(60_000);
    expect(pauseFor(new HttpError(502, "upstream_status", "TEC answered HTTP 403"))).toBe(3_600_000);
    expect(pauseFor(new HttpError(502, "upstream_status", "TEC answered HTTP 500"))).toBe(30_000);
  });
});
