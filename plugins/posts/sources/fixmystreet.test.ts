import { describe, expect, test } from "bun:test";
import { dateIn, dayLabel } from "../days";
import { firstDay, fmsCodes, fmsCollection, reportsFrom } from "./fixmystreet.server";

/**
 * Recorded on 2026-10-09 from the Brussels Mobility WFS without a property filter, so every feature carries its
 * free-text comment, house number, dates and photo ids: two reports per day from 2 to 8 October, the 2017 report whose comment
 * describes a former resident, and a copy of a real report with its geometry removed.
 */
const raw: unknown = await Bun.file(new URL("../fixtures/fixmystreet.json", import.meta.url)).json();
const codes = fmsCodes.parse(await Bun.file(new URL("../fixtures/fixmystreet-codes.json", import.meta.url)).json());
const collection = fmsCollection.parse(raw);
const REGION = { west: 4.2, south: 50.7, east: 4.5, north: 50.95 };

/** 07:00 in Brussels on 9 October. */
const MORNING = Date.parse("2026-10-09T05:00:00Z");
/** 00:30 in Brussels on 9 October, while it is still 8 October in UTC. */
const JUST_AFTER_MIDNIGHT = Date.parse("2026-10-08T22:30:00Z");
/** 23:30 in Brussels on 8 October. */
const LATE_EVENING = Date.parse("2026-10-08T21:30:00Z");

describe("Fix My Street dates", () => {
  test("dates are Brussels calendar days, not UTC days", () => {
    expect(dateIn("Europe/Brussels", JUST_AFTER_MIDNIGHT)).toBe("2026-10-09");
    expect(new Date(JUST_AFTER_MIDNIGHT).toISOString().slice(0, 10)).toBe("2026-10-08");
  });

  test("a report reads 'today', 'yesterday' or 'N days ago', never a made-up time", () => {
    expect(dayLabel("2026-10-09", "2026-10-09")).toBe("today");
    expect(dayLabel("2026-10-08", "2026-10-09")).toBe("yesterday");
    expect(dayLabel("2026-10-06", "2026-10-09")).toBe("3 days ago");
    expect(dayLabel("2026-10-10", "2026-10-09")).toBe("today");
  });

  test("the day changes at midnight in Brussels", () => {
    expect(dayLabel("2026-10-08", dateIn("Europe/Brussels", LATE_EVENING))).toBe("today");
    expect(dayLabel("2026-10-08", dateIn("Europe/Brussels", JUST_AFTER_MIDNIGHT))).toBe("yesterday");
  });

  test("the window is today and the seven days before it, across a month boundary too", () => {
    expect(firstDay(MORNING)).toBe("2026-10-02");
    expect(firstDay(LATE_EVENING)).toBe("2026-10-01");
    expect(firstDay(Date.parse("2026-11-03T10:00:00Z"))).toBe("2026-10-27");
  });

  test("posts keep the date as the source gives it, with no time and no 'seen' time", () => {
    const posts = reportsFrom(collection, codes, REGION, "en", MORNING);
    expect(posts.every((p) => /^\d{4}-\d{2}-\d{2}$/.test(p.postedAt) && p.seenAt === null)).toBe(true);
  });

  test("reports older than the window are dropped: the 2017 report is gone, the 2 October ones stay", () => {
    const posts = reportsFrom(collection, codes, REGION, "en", MORNING);
    expect(posts.some((p) => p.postedAt === "2017-05-28")).toBe(false);
    expect(posts.filter((p) => p.postedAt === "2026-10-02")).toHaveLength(2);
    expect(posts[0]?.postedAt).toBe("2026-10-08");
  });
});

describe("normalising Fix My Street reports", () => {
  const posts = reportsFrom(collection, codes, REGION, "fr-BE", MORNING);

  test("a report has its category, status, street, house number, comment, dates and page, and no photo or author", () => {
    expect(posts.find((p) => p.id === "fixmystreet:1221732")).toMatchObject({
      source: "fixmystreet",
      kind: "cleanliness",
      lat: 50.8341,
      lon: 4.3792,
      postedAt: "2026-10-08",
      title: "Litter and dumping",
      subtitle: "Rue Gray",
      photo: null,
      author: null,
      link: "https://fixmystreet.brussels/incidents/1221732",
      detail: {
        category: "Propreté publique / Dépôt clandestin / encombrants / < 1 m³",
        status: "progress",
        street: "Rue Gray",
        postcode: "1050",
        houseNumber: "118",
        comment: "En raison de l'occupation illégale du Jardin des Moineaux, on retrouve à nouveau des sacs poubelle non réglementaires jetés sur place.",
        updatedOn: "2026-10-08",
        closedOn: null,
      },
    });
  });

  test("Dutch readers get Dutch street and category names", () => {
    const dutch = reportsFrom(collection, codes, REGION, "nl-BE", MORNING).find((p) => p.id === "fixmystreet:1221732");
    expect(dutch?.detail.street).toBe("Graystraat");
    expect(dutch?.detail.category).toStartWith("Openbare netheid");
  });

  test("statuses map to new, in progress and closed", () => {
    expect(new Set(posts.map((p) => p.detail.status))).toEqual(new Set(["new", "progress", "closed"]));
  });

  test("a feature without geometry is skipped, and so is one outside the asked area", () => {
    expect(posts.some((p) => p.id === "fixmystreet:9999999")).toBe(false);
    expect(reportsFrom(collection, codes, { west: 4.378, south: 50.834, east: 4.381, north: 50.836 }, "fr", MORNING).map((p) => p.id)).toEqual(["fixmystreet:1221732"]);
  });

  test("reports carry their comment and house number, and the layer names no author or photo", () => {
    expect(posts.filter((p) => p.detail.comment).length).toBeGreaterThan(5);
    expect(posts.some((p) => p.detail.houseNumber)).toBe(true);
    expect(posts.every((p) => p.author === null && p.photo === null)).toBe(true);
  });
});
