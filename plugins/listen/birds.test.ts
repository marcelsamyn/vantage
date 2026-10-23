import { afterEach, describe, expect, test } from "bun:test";
import { HttpError } from "../../server/kit";
import { bestClip, birdsNear, hoursOfDay, meanCertainty, searchArea, streamClip, type Detection } from "./birds.server";
import type { BirdsNear } from "./types";

const call = (over: Partial<Detection> & { url?: string | null; at?: string } = {}): Detection => ({
  timestamp: over.at ?? "2026-10-08T15:52:38+02:00",
  confidence: over.confidence === undefined ? 0.5 : over.confidence,
  soundscape: over.url === null ? null : { url: over.url ?? "https://media.birdweather.com/soundscapes/1/1-20261008-135234.flac", startTime: 4.5, endTime: 7.5 },
});

describe("searchArea", () => {
  test("snaps the position to a 0.1° grid, so the exact spot is never sent", () => {
    const a = searchArea(41.8743, 12.4992);
    expect(a.centre).toEqual({ lat: 41.9, lon: 12.5 });
    expect(searchArea(41.9049, 12.5049).centre).toEqual(a.centre);
  });

  test("the box is wider than it is tall away from the equator", () => {
    const { ne, sw } = searchArea(60, 10);
    expect(ne.lat - sw.lat).toBeCloseTo(0.5, 5);
    expect(ne.lon - sw.lon).toBeGreaterThan(0.9);
  });

  test("stays on the globe near the pole and the date line", () => {
    const { ne, sw } = searchArea(89.97, 179.99);
    expect(ne.lat).toBeLessThanOrEqual(90);
    expect(ne.lon).toBeLessThanOrEqual(180);
    expect(sw.lon).toBeGreaterThan(-180);
  });
});

describe("bestClip", () => {
  test("picks the surest call that has a clip, and keeps only the seconds of the call", () => {
    const clip = bestClip([call({ confidence: 0.4, url: "https://media.birdweather.com/soundscapes/1/a.flac" }), call({ confidence: 0.9, url: "https://media.birdweather.com/soundscapes/1/b.flac" }), call({ confidence: 0.99, url: null })]);
    expect(clip).toMatchObject({ url: "https://media.birdweather.com/soundscapes/1/b.flac", startS: 4.5, endS: 7.5 });
  });

  test("refuses clips that are not on BirdWeather's media server", () => {
    expect(bestClip([call({ url: "https://evil.example/a.flac" }), call({ url: "javascript:alert(1)" }), call({ url: "http://media.birdweather.com/soundscapes/1/a.flac" })])).toBeNull();
  });

  test("a sample with no clip gives none", () => {
    expect(bestClip([])).toBeNull();
    expect(bestClip([call({ url: null })])).toBeNull();
  });
});

describe("meanCertainty", () => {
  test("averages the calls that report one", () => {
    expect(meanCertainty([call({ confidence: 0.5 }), call({ confidence: 0.7 }), call({ confidence: null })])).toBeCloseTo(0.6, 5);
    expect(meanCertainty([])).toBeNull();
  });
});

describe("hoursOfDay", () => {
  test("folds half-hour bins from every species into 24 hours", () => {
    const hours = hoursOfDay([
      {
        bins: [
          { key: 10.5, count: 37 },
          { key: 11, count: 106 },
        ],
      },
      { bins: [{ key: 11.5, count: 2 }] },
    ]);
    expect(hours).toHaveLength(24);
    expect(hours[10]).toBe(37);
    expect(hours[11]).toBe(108);
    expect(hours.reduce((a, b) => a + b, 0)).toBe(145);
  });
});

// ── The clip route ────────────────────────────────────────────────

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const STATION_CLIP = "https://media.birdweather.com/soundscapes/20037/20037-20261008-135234.flac";

/** Stands in for BirdWeather's GraphQL API and its media host, the two services under test. */
function fakeBirdWeather(media: (url: string, init: RequestInit) => Response): { mediaCalls: { url: string; init: RequestInit }[] } {
  const mediaCalls: { url: string; init: RequestInit }[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const url = String(input);
    if (url.startsWith("https://media.birdweather.com/")) {
      mediaCalls.push({ url, init });
      return media(url, init);
    }
    const { query } = JSON.parse(String(init.body)) as { query: string };
    const detection = { timestamp: "2026-10-08T15:52:38+02:00", confidence: 0.9, soundscape: { url: STATION_CLIP, startTime: 4.5, endTime: 7.5 } };
    const data = query.includes("topSpecies")
      ? {
          counts: { detections: 12, species: 1, stations: 1 },
          topSpecies: [{ speciesId: "3", count: 12, species: { commonName: "Eurasian Blackbird", scientificName: "Turdus merula" } }],
          timeOfDayDetectionCounts: [{ bins: [{ key: 7, count: 12 }] }],
        }
      : { a: { nodes: [detection] } };
    return Response.json({ data });
  }) as typeof fetch;
  return { mediaCalls };
}

const audio = (headers: Record<string, string> = {}): Response => new Response("fLaC-bytes", { headers: { "content-type": "audio/flac", ...headers } });

async function oneClip(lat: number): Promise<{ payload: BirdsNear; key: string }> {
  const payload = await birdsNear(lat, 4.3, "hour");
  const key = payload.top[0]?.clip?.key;
  if (!key) throw new Error("the fake station should give a clip");
  return { payload, key };
}

describe("birds clips", () => {
  test("no station id, file name or media address reaches the browser", async () => {
    fakeBirdWeather(() => audio());
    const { payload, key } = await oneClip(50.8);
    const text = JSON.stringify(payload);
    expect(text).not.toContain("20037");
    expect(text).not.toContain("birdweather.com");
    expect(text).not.toContain("soundscapes");
    expect(key).toMatch(/^[0-9a-f]{24}$/);
  });

  test("a key streams the file from the media host, passes Range on and reports the part", async () => {
    const { mediaCalls } = fakeBirdWeather(() => audio({ "content-range": "bytes 0-9/164364", "content-length": "10", "accept-ranges": "bytes" }));
    const { key } = await oneClip(50.9);
    const res = await streamClip(new Request("http://127.0.0.1/x", { headers: { range: "bytes=0-9" } }), key);
    expect(mediaCalls).toHaveLength(1);
    expect(mediaCalls[0]?.url).toBe(STATION_CLIP);
    expect(new Headers(mediaCalls[0]?.init.headers).get("range")).toBe("bytes=0-9");
    expect(res.headers.get("content-type")).toBe("audio/flac");
    expect(res.headers.get("content-range")).toBe("bytes 0-9/164364");
    expect(await res.text()).toBe("fLaC-bytes");
  });

  test("a key the server never issued is unknown, and nothing is fetched", async () => {
    const { mediaCalls } = fakeBirdWeather(() => audio());
    await expect(streamClip(new Request("http://127.0.0.1/x"), "0".repeat(24))).rejects.toMatchObject({ status: 404 });
    expect(mediaCalls).toHaveLength(0);
  });

  test("only audio of a sane size is relayed", async () => {
    fakeBirdWeather(() => new Response("<html>", { headers: { "content-type": "text/html" } }));
    const { key } = await oneClip(51);
    await expect(streamClip(new Request("http://127.0.0.1/x"), key)).rejects.toBeInstanceOf(HttpError);

    fakeBirdWeather(() => audio({ "content-length": "50000000" }));
    await expect(streamClip(new Request("http://127.0.0.1/x"), key)).rejects.toMatchObject({ code: "not_audio" });
  });

  test("the upstream request ends when the browser leaves", async () => {
    const { mediaCalls } = fakeBirdWeather(() => audio());
    const { key } = await oneClip(51.1);
    const gone = new AbortController();
    await streamClip(new Request("http://127.0.0.1/x", { signal: gone.signal }), key);
    const signal = mediaCalls[0]?.init.signal;
    expect(signal?.aborted).toBe(false);
    gone.abort();
    expect(signal?.aborted).toBe(true);
  });
});
