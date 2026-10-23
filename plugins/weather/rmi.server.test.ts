import { expect, test } from "bun:test";
import { fetchUpstream, HttpError } from "../../server/kit";
import { boxAround, cloudBase, cloudLayers, nearest, tally, worthRetrying, type LidarRow, type Station } from "./rmi.server";

const LIDARS: Station[] = [
  { code: 6447, name: "Uccle-Ukkel", lat: 50.797, lon: 4.358 },
  { code: 6418, name: "Zeebrugge", lat: 51.348, lon: 3.202 },
  { code: 6472, name: "Humain", lat: 50.194, lon: 5.255 },
  { code: 6477, name: "Diepenbeek", lat: 50.916, lon: 5.45 },
];

test("the nearest station is chosen, with its distance, and none is chosen beyond the limit", () => {
  expect(nearest(LIDARS, { lat: 50.85, lon: 4.35 }, 80)).toMatchObject({ station: { name: "Uccle-Ukkel" }, distanceKm: 6 });
  expect(nearest(LIDARS, { lat: 51.22, lon: 2.9 }, 80)?.station.name).toBe("Zeebrugge");
  expect(nearest(LIDARS, { lat: 41.9, lon: 12.5 }, 80)).toBeNull();
});

const row = (over: Partial<LidarRow>): LidarRow => ({
  lowest_cloud_base_height_1: null,
  cloud_layer_1_height: null,
  cloud_layer_1_amount: null,
  cloud_layer_2_height: null,
  cloud_layer_2_amount: null,
  cloud_layer_3_height: null,
  cloud_layer_3_amount: null,
  ...over,
});

test("a ceilometer's -999 and 0 mean no reading, not a cloud at ground level", () => {
  expect(cloudBase(row({ lowest_cloud_base_height_1: -999 }))).toBeNull();
  expect(cloudBase(row({ lowest_cloud_base_height_1: 0 }))).toBeNull();
  expect(cloudBase(row({ lowest_cloud_base_height_1: 1320 }))).toBe(1320);
});

test("layers keep their height and oktas and skip empty slots (Zeebrugge, 2026-10-09 00:00 UTC)", () => {
  const zeebrugge = row({
    lowest_cloud_base_height_1: 1320,
    cloud_layer_1_height: 1280,
    cloud_layer_1_amount: 2,
    cloud_layer_2_height: 2230,
    cloud_layer_2_amount: 4,
    cloud_layer_3_height: 3200,
    cloud_layer_3_amount: 7,
  });
  expect(cloudLayers(zeebrugge)).toEqual([
    { heightM: 1280, oktas: 2 },
    { heightM: 2230, oktas: 4 },
    { heightM: 3200, oktas: 7 },
  ]);
  expect(cloudLayers(row({ cloud_layer_1_height: 920, cloud_layer_1_amount: 0 }))).toEqual([]);
});

test("the crowd box is about 20 km each way and is returned latitude first, as the WFS filter reads it", () => {
  const [south, west, north, east] = boxAround({ lat: 50.85, lon: 4.35 }, 20);
  expect(south).toBeCloseTo(50.67, 2);
  expect(north).toBeCloseTo(51.03, 2);
  expect(west).toBeCloseTo(4.065, 2);
  expect(east).toBeCloseTo(4.635, 2);
});

/** The error `fetchUpstream` raises when the service answers with this status. */
async function failureFor(status: number, headers: Record<string, string> = {}): Promise<HttpError> {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response("no", { status, headers })) as unknown as typeof fetch;
  try {
    await fetchUpstream("RMI open data", "https://example.test/wfs");
  } catch (err) {
    if (err instanceof HttpError) return err;
  } finally {
    globalThis.fetch = realFetch;
  }
  throw new Error(`HTTP ${status} should have raised an HttpError`);
}

test("a busy or failing server is asked again, and a refusal or a rate limit is not", async () => {
  expect(worthRetrying(await failureFor(500))).toBe(true);
  expect(worthRetrying(await failureFor(503))).toBe(true);
  expect(worthRetrying(await failureFor(429, { "retry-after": "30" }))).toBe(false);
  expect(worthRetrying(await failureFor(404))).toBe(false);
  expect(worthRetrying(await failureFor(400))).toBe(false);
  expect(worthRetrying(new HttpError(502, "upstream_busy", "RMI open data is busy"))).toBe(true);
  expect(worthRetrying(new HttpError(504, "upstream_timeout", "RMI open data did not answer within 20 s"))).toBe(true);
  expect(worthRetrying(new HttpError(502, "upstream_shape", "RMI sent unexpected data"))).toBe(false);
});

test("crowd reports are counted by kind, most common first, without any position", () => {
  expect(tally(["Rain", "Fog", "Rain", "Hail", "Fog", "Rain"])).toEqual([
    { kind: "Rain", count: 3 },
    { kind: "Fog", count: 2 },
    { kind: "Hail", count: 1 },
  ]);
});
