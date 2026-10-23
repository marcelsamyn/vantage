import { afterEach, expect, mock, setSystemTime, spyOn, test } from "bun:test";
import { flowTile, loadTraffic } from "./api";
import { resetTomTom } from "./tomtom.server";

const realFetch = globalThis.fetch;
const originalKey = process.env.VANTAGE_TOMTOM_KEY;
const START = Date.parse("2026-10-17T08:00:00Z");
afterEach(() => {
  mock.restore();
  resetTomTom();
  setSystemTime();
  if (originalKey === undefined) delete process.env.VANTAGE_TOMTOM_KEY;
  else process.env.VANTAGE_TOMTOM_KEY = originalKey;
});

/** Requests TomTom saw, in order; each tile answers with its request number. */
function fakeTomTom(answer?: (url: URL) => Response | undefined): string[] {
  process.env.VANTAGE_TOMTOM_KEY = "queue-test-key";
  const seen: string[] = [];
  spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      seen.push(url.pathname.split("/vector/tile/")[1] ?? url.searchParams.get("bbox") ?? url.pathname);
      return answer?.(url) ?? new Response(new Uint8Array([seen.length]), { headers: { "content-type": "application/vnd.mapbox-vector-tile" } });
    }, { preconnect: realFetch.preconnect }),
  );
  return seen;
}
/** Time is frozen in these tests; move it on and let the queue's timers run. */
async function advance(ms: number): Promise<void> {
  setSystemTime(Date.now() + ms);
  await Bun.sleep(ms + 5);
}
/** What a request settles to, moving time on so the queue's spacing between requests passes. */
async function settle(promise: Promise<unknown>): Promise<unknown> {
  let done = false;
  const outcome = promise.then((v) => v, (err: unknown) => err).finally(() => { done = true; });
  for (let i = 0; i < 20 && !done; i++) await advance(25);
  return outcome;
}
const bytes = async (r: Response): Promise<number[]> => [...new Uint8Array(await r.arrayBuffer())];

test("a stale flow tile is served at once and refreshed in the background", async () => {
  const seen = fakeTomTom();
  setSystemTime(START);
  const tile = { z: 14, x: 8400, y: 5500 };
  const first = await flowTile(tile);
  expect(first.headers.get("cache-control")).toBe("private, max-age=300");
  setSystemTime(START + 299_000);
  expect(await bytes(await flowTile(tile))).toEqual([1]);
  expect(seen).toHaveLength(1);
  setSystemTime(START + 300_000);
  const stale = await flowTile(tile);
  expect(await bytes(stale)).toEqual([1]);
  expect(stale.headers.get("cache-control")).toBe("private, max-age=60");
  await advance(30);
  expect(seen).toHaveLength(2);
  expect(await bytes(await flowTile(tile))).toEqual([2]);
});

test("missing tiles load before refreshes, newest request first", async () => {
  const seen = fakeTomTom();
  setSystemTime(START);
  await flowTile({ z: 14, x: 1, y: 1 });
  setSystemTime(START + 400_000);
  const pending = [
    flowTile({ z: 14, x: 2, y: 2 }),
    flowTile({ z: 14, x: 3, y: 3 }),
    flowTile({ z: 14, x: 4, y: 4 }),
    flowTile({ z: 14, x: 1, y: 1 }),
  ];
  for (let i = 0; i < 5; i++) await advance(25);
  await Promise.all(pending);
  // 2/2 starts at once. The stale 1/1 is asked for last but is served from cache, so its refresh waits for 4/4 and 3/3.
  expect(seen).toEqual(["14/1/1", "14/2/2", "14/4/4", "14/3/3", "14/1/1"]);
});

test("a request whose browser left before its turn costs nothing", async () => {
  const seen = fakeTomTom();
  setSystemTime(START);
  const first = flowTile({ z: 14, x: 1, y: 1 });
  const leaving = new AbortController();
  const gone = flowTile({ z: 14, x: 2, y: 2 }, leaving.signal);
  leaving.abort(new Error("scrolled away"));
  await expect(gone).rejects.toThrow("scrolled away");
  await first;
  await advance(50);
  expect(seen).toEqual(["14/1/1"]);
});

test("a shared request still loads for the caller that stayed", async () => {
  const seen = fakeTomTom();
  setSystemTime(START);
  const first = flowTile({ z: 14, x: 1, y: 1 });
  const leaving = new AbortController();
  const gone = flowTile({ z: 14, x: 2, y: 2 }, leaving.signal);
  const staying = flowTile({ z: 14, x: 2, y: 2 });
  leaving.abort(new Error("scrolled away"));
  await expect(gone).rejects.toThrow("scrolled away");
  await first;
  expect(await bytes(await (settle(staying) as Promise<Response>))).toEqual([2]);
  expect(seen).toEqual(["14/1/1", "14/2/2"]);
});

test("spent TomTom credits pause requests with a clear message and keep loaded answers", async () => {
  let broke = false;
  const seen = fakeTomTom(() =>
    broke
      ? Response.json({ detailedError: { code: "InsufficientFunds", message: "You do not have enough credits to perform this action" } }, { status: 403 })
      : undefined,
  );
  setSystemTime(START);
  const tile = { z: 14, x: 1, y: 1 };
  await flowTile(tile);
  broke = true;
  const failure = await settle(flowTile({ z: 14, x: 2, y: 2 }));
  expect(String(failure)).toContain("no TomTom credits left");
  expect(String(failure)).not.toContain("queue-test-key");
  setSystemTime(START + 400_000);
  expect(await bytes(await flowTile(tile))).toEqual([1]);
  await expect(flowTile({ z: 14, x: 3, y: 3 })).rejects.toThrow("no TomTom credits left");
  await advance(50);
  expect(seen).toEqual(["14/1/1", "14/2/2"]);
});

test("incidents are fetched per fixed cell, so a small pan asks TomTom for nothing new", async () => {
  const seen = fakeTomTom(() => Response.json({ incidents: [] }));
  setSystemTime(START);
  await loadTraffic("tomtom", { west: 4.35, south: 50.83, east: 4.38, north: 50.86 });
  await loadTraffic("tomtom", { west: 4.36, south: 50.84, east: 4.39, north: 50.87 });
  expect(seen).toHaveLength(1);
  expect(seen[0]?.split(",").map(Number)).toEqual([expect.closeTo(4.21875, 5), expect.closeTo(50.73646, 5), expect.closeTo(4.921875, 5), expect.closeTo(51.17934, 5)]);
});
