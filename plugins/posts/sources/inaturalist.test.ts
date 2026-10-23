import { describe, expect, test } from "bun:test";
import { inatPage, inaturalist, sightingsFrom } from "./inaturalist.server";

/**
 * Recorded on 2026-10-09: seven v1 observations around Rome with their full `user` objects, identifications by other
 * people and photo attributions that name the photographer; one obscured observation from the v2 API (Hainaut,
 * Belgium); and two copies of real records changed on purpose: one made private (no location) and one posted 30 hours
 * before the test clock.
 */
const raw: unknown = await Bun.file(new URL("../fixtures/inaturalist.json", import.meta.url)).json();
const NOW = Date.parse("2026-10-09T07:00:00+02:00");
const posts = sightingsFrom(inatPage.parse(raw), NOW);
const byId = (id: number) => posts.find((p) => p.id === `inaturalist:${id}`);

describe("normalising iNaturalist observations", () => {
  test("keeps posts of the last 24 hours that have a position, newest first", () => {
    expect(posts.map((p) => p.id)).toEqual([
      "inaturalist:406941240",
      "inaturalist:406933008",
      "inaturalist:406918150",
      "inaturalist:406879614",
      "inaturalist:406876360",
      "inaturalist:406866610",
      "inaturalist:406860386",
      "inaturalist:406850629",
    ]);
  });

  test("a sighting carries its species, life group, times and page", () => {
    expect(byId(406941240)).toMatchObject({
      source: "inaturalist",
      kind: "birds",
      lat: 41.89018,
      lon: 12.4923116667,
      uncertaintyM: 1,
      postedAt: "2026-10-09T04:37:27.000Z",
      seenAt: "2024-06-26T10:11:01+02:00",
      title: "Yellow-legged Gull",
      subtitle: "Larus michahellis",
      link: "https://www.inaturalist.org/observations/406941240",
      detail: { scientificName: "Larus michahellis", rank: "species", approximate: false, placeGuess: "Piazza del Colosseo, Rome, Lazio, IT", description: null, identifications: 0, faves: 0 },
    });
  });

  test("life groups follow the iconic taxon, and an unidentified post is 'other' with a plain title", () => {
    expect(byId(406918150)?.kind).toBe("plants");
    expect(byId(406879614)?.kind).toBe("vertebrates");
    expect(byId(406876360)?.kind).toBe("invertebrates");
    expect(byId(406850629)?.kind).toBe("vertebrates");
    const unknown = byId(406860386);
    expect(unknown?.kind).toBe("other");
    expect(unknown?.title).toBe("Unidentified life");
  });

  test("skips an observation without a position and one posted more than a day ago", () => {
    expect(byId(990000001)).toBeUndefined();
    expect(byId(990000002)).toBeUndefined();
  });
});

describe("photos and licences", () => {
  test("a CC BY-NC photo is shown with iNaturalist's own credit text", () => {
    expect(byId(406941240)?.photo).toEqual({
      url: "https://inaturalist-open-data.s3.amazonaws.com/photos/747743176/medium.jpg",
      thumb: "https://inaturalist-open-data.s3.amazonaws.com/photos/747743176/square.jpg",
      credit: "(c) Observer 01, some rights reserved (CC BY-NC)",
      licence: "CC BY-NC 4.0",
    });
  });

  test("a photo with all rights reserved (licence null) is shown with its credit", () => {
    const reserved = byId(406866610);
    expect(reserved?.photo).toMatchObject({ credit: "(c) Observer 08, all rights reserved", licence: "All rights reserved" });
    expect(reserved?.photo?.url).toEndWith("/medium.jpg");
    expect(reserved?.link).toBe("https://www.inaturalist.org/observations/406866610");
  });

  test("an unidentified post shows its photo", () => {
    const unknown = byId(406860386);
    expect(unknown?.title).toBe("Unidentified life");
    expect(unknown?.photo?.licence).toBe("All rights reserved");
  });

  test("an unknown licence code is shown as written; a non-web address shows no photo", () => {
    const page = inatPage.parse(raw);
    const first = page.results[0];
    if (!first) throw new Error("fixture is empty");
    const url = first.photos?.[0]?.url;
    const odd = { ...page, results: [{ ...first, photos: [{ url: "javascript:alert(1)/square.jpg", license_code: "cc-by" }, { url, license_code: "cc-by-xyz", attribution: null }] }] };
    expect(sightingsFrom(odd, NOW)[0]?.photo).toMatchObject({ licence: "CC-BY-XYZ", credit: "Photo: iNaturalist · CC-BY-XYZ" });
    expect(sightingsFrom({ ...page, results: [{ ...first, photos: [{ url: "javascript:alert(1)/square.jpg", license_code: "cc-by" }] }] }, NOW)[0]?.photo).toBeNull();
  });
});

describe("obscured positions", () => {
  test("an obscured observation is approximate, with the uncertainty iNaturalist publishes", () => {
    const hidden = byId(406933008);
    expect(hidden?.detail.approximate).toBe(true);
    expect(hidden?.uncertaintyM).toBe(26_357);
  });

  test("geoprivacy set by the observer makes a post approximate even when `obscured` is false", () => {
    const page = inatPage.parse(raw);
    const first = page.results[0];
    if (!first) throw new Error("fixture is empty");
    const [post] = sightingsFrom({ ...page, results: [{ ...first, obscured: false, geoprivacy: "obscured", public_positional_accuracy: null }] }, NOW);
    expect(post?.detail.approximate).toBe(true);
    // Without a stated accuracy, the radius is the diagonal of iNaturalist's 0.2° cell at that latitude.
    expect(post?.uncertaintyM).toBeGreaterThan(25_000);
    expect(post?.uncertaintyM).toBeLessThan(30_000);
  });

  test("an 'open' taxon geoprivacy is an exact position", () => {
    expect(byId(406941240)?.detail.approximate).toBe(false);
  });
});

describe("people", () => {
  test("a sighting carries its observer: name, handle, avatar and a profile link on iNaturalist", () => {
    expect(byId(406941240)?.author).toEqual({
      name: "Observer 01",
      handle: "observer_01",
      profile: "https://www.inaturalist.org/people/observer_01",
      avatar: "https://static.inaturalist.org/attachments/users/icons/900001/medium.jpg",
    });
    expect(byId(406879614)?.author).toEqual({ name: null, handle: "observer_05", profile: "https://www.inaturalist.org/people/observer_05", avatar: null });
  });

  test("an observation without an observer has no author", () => {
    expect(byId(406933008)?.author).toBeNull();
  });

  test("a sighting of a person is kept, with its photo", () => {
    const page = inatPage.parse(raw);
    const first = page.results[0];
    if (!first) throw new Error("fixture is empty");
    const human = { ...first, taxon: { name: "Homo sapiens", rank: "species", preferred_common_name: "Human", iconic_taxon_name: "Mammalia" } };
    const [post] = sightingsFrom({ ...page, results: [human] }, NOW);
    expect(post).toMatchObject({ title: "Human", subtitle: "Homo sapiens", kind: "vertebrates" });
    expect(post?.photo?.url).toEndWith("/medium.jpg");
  });

  test("the observer's note, place and counts come through; a zero count stays zero", () => {
    const page = inatPage.parse(raw);
    const withNote = page.results.find((r) => r.description);
    if (!withNote) throw new Error("fixture has no description");
    const post = sightingsFrom({ ...page, results: [withNote] }, NOW)[0];
    expect(post?.detail.description).toBe(withNote.description?.trim());
    expect(post?.detail.placeGuess).toBe(withNote.place_guess?.trim());
    expect(byId(406941240)?.detail).toMatchObject({ identifications: 0, agreements: 0, faves: 0, comments: 0 });
  });
});

describe("the request", () => {
  test("asks for the observer, the photo attribution and the observation's own text, and leaves no one out", async () => {
    const asked: string[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL): Promise<Response> => {
      asked.push(String(input));
      return Response.json(raw);
    }) as typeof fetch;
    try {
      await inaturalist.posts({ west: 90.1, south: 10.1, east: 90.2, north: 10.2 }, { locale: "en", now: NOW });
    } finally {
      globalThis.fetch = realFetch;
    }
    const url = new URL(asked[0] ?? "");
    const fields = url.searchParams.get("fields")?.split(",") ?? [];
    expect(fields).toEqual(expect.arrayContaining(["user.login", "user.name", "user.icon", "photos.attribution", "description", "place_guess"]));
    expect(url.searchParams.has("without_taxon_id")).toBe(false);
  });
});
