import { expect, test } from "bun:test";
import { deflateSync } from "node:zlib";
import { FRAME_KEPT_MS, frameTimes, lightningFrames, lightningImage, parseTimeDimension, pngAlpha, spotsIn } from "./satellite.server";

/** An 8-bit RGBA PNG whose rows use the given filter types; each row's bytes are the filtered values. */
function png(width: number, height: number, rows: { filter: number; bytes: number[] }[]): Uint8Array {
  const chunk = (type: string, body: Uint8Array): Uint8Array => {
    const out = new Uint8Array(12 + body.length);
    const view = new DataView(out.buffer);
    view.setUint32(0, body.length);
    out.set([...type].map((c) => c.charCodeAt(0)), 4);
    out.set(body, 8);
    return out;
  };
  const header = new Uint8Array(13);
  const hv = new DataView(header.buffer);
  hv.setUint32(0, width);
  hv.setUint32(4, height);
  header.set([8, 6, 0, 0, 0], 8);
  const raw = new Uint8Array(rows.length * (width * 4 + 1));
  rows.forEach((r, y) => raw.set([r.filter, ...r.bytes], y * (width * 4 + 1)));
  const parts = [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", header), chunk("IDAT", deflateSync(raw)), chunk("IEND", new Uint8Array())];
  return Uint8Array.from(parts.flatMap((p) => [...p]));
}

/** The time dimension of EUMETView's `mtg_fd:li_afa` layer, as served on 2026-10-09. */
const CAPABILITIES = `<Layer queryable="1" opaque="0"><Name>mtg_fd:li_afa</Name>
<Dimension name="time" default="2026-10-09T00:20:00Z" units="ISO8601" nearestValue="1">2025-05-30T15:00:00.000Z/2026-10-09T00:20:00.000Z/PT5M</Dimension></Layer>`;

test("the newest frame and the step come from the layer's time dimension", () => {
  expect(parseTimeDimension(CAPABILITIES)).toEqual({ latest: "2026-10-09T00:20:00Z", stepMin: 5 });
});

test("a document without a time dimension gives nothing", () => {
  expect(parseTimeDimension("<Layer><Name>mtg_fd:li_afa</Name></Layer>")).toBeNull();
});

test("the loop is the newest frames, oldest first, on the service's own grid", () => {
  const times = frameTimes({ latest: "2026-10-09T00:20:00Z", stepMin: 5 }, 12);
  expect(times).toHaveLength(12);
  expect(times[0]).toBe("2026-10-08T23:25:00Z");
  expect(times.at(-1)).toBe("2026-10-09T00:20:00Z");
});

test("alpha is read through the row filters a PNG encoder may choose", () => {
  // Row 0 uses no filter. Row 1 uses "up": each byte adds the byte above, so zeros repeat row 0.
  const image = png(2, 2, [
    { filter: 0, bytes: [0, 0, 0, 0, 0, 0, 0, 255] },
    { filter: 2, bytes: [0, 0, 0, 0, 0, 0, 0, 0] },
  ]);
  const { width, height, alpha } = pngAlpha(image);
  expect([width, height]).toEqual([2, 2]);
  expect([...alpha]).toEqual([0, 255, 0, 255]);
});

test("touching marks become one detection placed by the picture's own bounds", () => {
  // A 100 x 100 picture with one 3 x 3 mark in the middle and one single pixel in the top-left corner.
  const alpha = new Uint8Array(100 * 100);
  for (let y = 49; y < 52; y++) for (let x = 49; x < 52; x++) alpha[y * 100 + x] = 255;
  alpha[0] = 255;
  const spots = spotsIn({ width: 100, height: 100, alpha });
  expect(spots).toHaveLength(2);
  expect(spots.find((s) => Math.abs(s.lon - 14) < 1)).toBeDefined();
  expect(spots.find((s) => s.lon < -11.5)?.lat).toBeGreaterThan(61);
});

test("a lightning frame is kept for the length of the loop and never served stale beyond it", async () => {
  const realFetch = globalThis.fetch;
  const realNow = Date.now;
  const drawn: string[] = [];
  let mapsDown = false;
  // Stands in for EUMETView: the capabilities document lists the layer, and map requests answer with a PNG until it goes down.
  globalThis.fetch = (async (input: RequestInfo | URL): Promise<Response> => {
    const url = new URL(String(input));
    if (url.searchParams.get("request") === "GetCapabilities") return new Response(CAPABILITIES);
    drawn.push(url.searchParams.get("time") ?? "");
    if (mapsDown) return new Response("down", { status: 503 });
    return new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]), { headers: { "content-type": "image/png" } });
  }) as unknown as typeof fetch;
  const later = (ms: number): void => {
    const start = realNow();
    Date.now = () => start + ms;
  };
  try {
    const { frames } = await lightningFrames();
    expect(frames).toHaveLength(12);
    for (const t of frames) await lightningImage(t);
    expect(drawn).toEqual(frames);

    // Inside the loop's hour and ten minutes the frame comes from memory.
    later(FRAME_KEPT_MS - 60_000);
    await lightningImage(frames[0] as string);
    expect(drawn).toHaveLength(12);

    // Past it the frame is drawn again, and when the service is down the old picture is not served in its place:
    // with the default stale window (thirty hours) all of these frames would stay in memory.
    later(FRAME_KEPT_MS + 60_000);
    mapsDown = true;
    await expect(lightningImage(frames[1] as string)).rejects.toMatchObject({ status: 502 });
    mapsDown = false;
    await lightningImage(frames[0] as string);
    expect(drawn).toHaveLength(14);

    // Only the frames the service lists can be asked for, so memory holds at most the loop.
    await expect(lightningImage("2020-01-01T00:00:00Z")).rejects.toMatchObject({ status: 404 });
  } finally {
    Date.now = realNow;
    globalThis.fetch = realFetch;
  }
});
