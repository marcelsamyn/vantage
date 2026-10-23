import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { unlink } from "node:fs/promises";
import { join } from "node:path";
import { normaliseCountry, splitName, zoneKey, zonesFor } from "./mics.server";
import type { Microphone } from "./types";

describe("splitName", () => {
  test("splits place and spot at the em dash and tidies the case", () => {
    expect(splitName("bruxelles — rue de la poudrière")).toEqual({ place: "Bruxelles", name: "Rue de la poudrière" });
    expect(splitName("usti nad labem — duul")).toEqual({ place: "Usti nad Labem", name: "Duul" });
  });

  test("keeps commas in the place and collapses double spaces", () => {
    expect(splitName("koos, greifswald — island koos listening station")).toEqual({ place: "Koos, Greifswald", name: "Island koos listening station" });
    expect(splitName("sulina  — sulina")).toEqual({ place: "Sulina", name: "Sulina" });
  });

  test("a name without a spot is used for both", () => {
    expect(splitName("lonely mic")).toEqual({ place: "Lonely Mic", name: "Lonely Mic" });
  });
});

describe("normaliseCountry", () => {
  test("fixes the spellings streamers typed", () => {
    expect(normaliseCountry("uk")).toBe("United Kingdom");
    expect(normaliseCountry("Schweiz")).toBe("Switzerland");
    expect(normaliseCountry("Unites States")).toBe("United States");
    expect(normaliseCountry("netherlands")).toBe("Netherlands");
  });

  test("an empty country is unknown, not an empty label", () => {
    expect(normaliseCountry("")).toBeNull();
    expect(normaliseCountry("  ")).toBeNull();
    expect(normaliseCountry(undefined)).toBeNull();
  });
});

describe("zonesFor", () => {
  const realFetch = globalThis.fetch;
  const cacheDir = join(import.meta.dir, "..", "..", ".cache");
  // Positions no real microphone has, new on every run so an earlier run's disk cache cannot answer.
  const base = 70 + Math.random() * 10;
  const mic = (n: number): Microphone => ({ id: `ls-${n}`, source: "locustream", name: "m", place: "p", country: null, lat: Math.round((base + n / 10) * 100) / 100, lon: Math.round((20 + n / 10) * 100) / 100, timezone: null, format: "mp3", stream: null, live: true, homepage: "" });
  const mics = [mic(1), mic(2), mic(3), mic(4)];

  /** Stands in for Open-Meteo: names a zone after each latitude asked and records what was asked. */
  function fakeOpenMeteo(status = 200): { asked: number[][] } {
    const asked: number[][] = [];
    globalThis.fetch = (async (input: RequestInfo | URL): Promise<Response> => {
      const lats = (new URL(String(input)).searchParams.get("latitude") ?? "").split(",").map(Number);
      asked.push(lats);
      const zones = lats.map((lat) => ({ timezone: `Test/Zone_${lat}` }));
      // As the real service does: one place gives an object, several give an array.
      return status === 200 ? Response.json(zones.length === 1 ? zones[0] : zones) : new Response("busy", { status });
    }) as typeof fetch;
    return { asked };
  }

  afterEach(() => {
    globalThis.fetch = realFetch;
  });
  afterAll(async () => {
    await Promise.all(mics.map((m) => unlink(join(cacheDir, `${zoneKey(m)}.json`)).catch(() => undefined)));
  });

  test("a change to the list asks only about the places that are new", async () => {
    const first = fakeOpenMeteo();
    const zones = await zonesFor(mics.slice(0, 3));
    expect(first.asked).toEqual([mics.slice(0, 3).map((m) => m.lat)]);
    expect(zones.get("ls-2")).toBe(`Test/Zone_${mics[1]?.lat}`);

    const second = fakeOpenMeteo();
    const all = await zonesFor(mics);
    expect(second.asked).toEqual([mics.slice(3).map((m) => m.lat)]);
    expect([...all.keys()]).toHaveLength(4);
    expect(all.get("ls-4")).toBe(`Test/Zone_${mics[3]?.lat}`);

    const third = fakeOpenMeteo();
    await zonesFor(mics);
    expect(third.asked).toEqual([]);
  });

  test("a failed request still gives the zones already known", async () => {
    const later = { ...mic(5), id: "ls-5" };
    fakeOpenMeteo(429);
    const zones = await zonesFor([...mics, later]);
    expect(zones.has("ls-5")).toBe(false);
    expect(zones.size).toBe(4);
  });
});
