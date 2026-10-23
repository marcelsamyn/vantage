import { describe, expect, test } from "bun:test";
import { reportItems, sightingItems } from "./nearby";
import type { ReportDetail, Sighting, SightingDetail, StreetReport } from "./types";

const NOW = Date.parse("2026-10-09T10:00:00+02:00");
const AT = { lat: 50.8467, lon: 4.3525 };

const sightingDetail: SightingDetail = {
  scientificName: "Larus michahellis",
  rank: "species",
  quality: "research",
  approximate: false,
  description: null,
  placeGuess: null,
  identifications: 2,
  agreements: 2,
  faves: 0,
  comments: 0,
};
const sighting: Sighting = {
  id: "inaturalist:1",
  source: "inaturalist",
  kind: "birds",
  lat: 50.8468,
  lon: 4.3526,
  uncertaintyM: null,
  postedAt: "2026-10-09T06:37:27+02:00",
  seenAt: "2026-10-09T08:11:01+02:00",
  title: "Yellow-legged Gull",
  subtitle: null,
  photo: null,
  author: null,
  link: "https://www.inaturalist.org/observations/1",
  detail: sightingDetail,
};

const reportDetail: ReportDetail = { category: "Propreté publique / Corbeille débordante", status: "new", street: "Rue Gray", postcode: "1050", houseNumber: "118", comment: null, updatedOn: null, closedOn: null };
const report = (id: string, link: string | null, status: ReportDetail["status"] = "new"): StreetReport => ({
  id: `fixmystreet:${id}`,
  source: "fixmystreet",
  kind: "cleanliness",
  lat: 50.8471,
  lon: 4.3529,
  uncertaintyM: null,
  postedAt: "2026-10-08",
  seenAt: null,
  title: "Corbeille débordante",
  subtitle: null,
  photo: null,
  author: null,
  link,
  detail: { ...reportDetail, status },
});

describe("sightingItems", () => {
  test("a sighting is something to see: Show it opens the profile, Walk there comes after", () => {
    const [item] = sightingItems([sighting], AT, 1000, NOW);
    expect(item).toMatchObject({ kind: "see", title: "Yellow-legged Gull", primary: { label: "Show it" } });
    expect(item?.more?.map((a) => a.label)).toEqual(["Walk there"]);
  });
});

describe("reportItems", () => {
  test("a report opens its profile and offers the walk and the report page", () => {
    const [item] = reportItems([report("1", "https://fixmystreet.brussels/report/1")], AT, 1000, NOW);
    expect(item).toMatchObject({ kind: "see", primary: { label: "Show report" } });
    expect(item?.more?.map((a) => a.label)).toEqual(["Walk there", "Open the report"]);
  });

  test("without a link there is only the walk, and closed reports are left out", () => {
    const items = reportItems([report("1", null), report("2", null, "closed")], AT, 1000, NOW);
    expect(items).toHaveLength(1);
    expect(items[0]?.more?.map((a) => a.label)).toEqual(["Walk there"]);
  });
});
