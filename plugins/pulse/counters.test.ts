import { afterEach, expect, mock, spyOn, test } from "bun:test";
import { unlink } from "node:fs/promises";
import { join } from "node:path";
import { ghentBins } from "./counters.server";

const id = `test-${crypto.randomUUID()}`;
afterEach(async () => {
  mock.restore();
  await unlink(join(import.meta.dir, "../../.cache", `pulse-ghent-bins-${id}.json`)).catch(() => undefined);
});

test("Ghent bins use the published timestamp rather than a missing interval field", async () => {
  const realFetch = globalThis.fetch;
  const fetch = spyOn(globalThis, "fetch").mockImplementation(Object.assign(async (input: URL | RequestInfo): Promise<Response> => {
    const url = new URL(String(input));
    expect(url.searchParams.get("select")).toBe("ordening,totaal");
    return Response.json([
      { ordening: "2026-09-30T21:45:00+00:00", totaal: "45" },
      { ordening: "2026-09-30T21:30:00+00:00", totaal: "34" },
    ]);
  }, { preconnect: realFetch.preconnect }));
  const bins = await ghentBins({ id, name: "Dampoort-Zuid", dataset: "fietstelpaal-dampoort-zuid-2026-gent", lat: 51.05, lon: 3.73 });
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(bins).toEqual([
    { at: Date.parse("2026-09-30T21:30:00Z"), count: 34 },
    { at: Date.parse("2026-09-30T21:45:00Z"), count: 45 },
  ]);
});
