import { describe, expect, test } from "bun:test";
import recorded from "./fixtures/rail-works-brussels.json";
import { workItems } from "./nearby-works";
import { worksNear } from "./rail.server";
import type { RailWork, RailWorks } from "./types";

// Infrabel restrictions around Etterbeek and Schaarbeek, as /api/transit/rail/works answered on 10 October 2026. A JSON module types its strings as `string`, so the cast only narrows `impact`.
const data = recorded as RailWorks;
const workAt = (i: number): RailWork => {
  const work = data.works[i];
  if (!work) throw new Error(`The fixture has no work ${i}`);
  return work;
};
const ETTERBEEK = { lat: 50.8208, lon: 4.3905 };
const SCHAARBEEK = { lat: 50.8789, lon: 4.379 };
const WOLUWE = { lat: 50.84, lon: 4.45 };
const found = (at: { lat: number; lon: number }, radiusM: number) => worksNear(data.works, at, radiusM);

describe("workItems", () => {
  test("a restriction in force has a start in the past and an end on its last day", () => {
    const [item] = workItems(found(ETTERBEEK, 1500), ETTERBEEK, 1500);
    expect(item).toMatchObject({
      id: "91849-161-2026-04-20-05:00:00",
      kind: "see",
      tone: "sodium",
      title: "Line 161, near Etterbeek",
      detail: "Other Type of Restriction · Both tracks",
      primary: { label: "Show works" },
    });
    expect(item?.startsAt).toBe(Date.parse("2026-04-20T00:00:00"));
    expect(item?.until).toBe(Date.parse("2027-07-04T23:59:59"));
    expect(item?.entity).toMatchObject({ kind: "railwork", id: "91849-161-2026-04-20-05:00:00" });
    expect(item?.more?.map((a) => a.label)).toEqual(["Walk there"]);
  });

  test("the marker sits on the track point nearest to you", () => {
    const [item] = workItems(found(SCHAARBEEK, 500), SCHAARBEEK, 500);
    expect(item?.at).toEqual({ lat: 50.878939, lon: 4.378964 });
  });

  test("a restriction that starts later keeps its first day as the start", () => {
    const items = workItems(found(SCHAARBEEK, 2000), SCHAARBEEK, 2000);
    const later = items.find((i) => i.id.startsWith("77511-27"));
    expect(later?.startsAt).toBe(Date.parse("2027-01-04T00:00:00"));
    expect(later?.until).toBe(Date.parse("2027-05-16T23:59:59"));
  });

  test("a restriction with no station names says only its line, and a night work names its hours", () => {
    const night = { ...workAt(2), continuity: "Night", timeFrom: "22:00", timeTo: "05:00", impact: "Major" as const };
    const [item] = workItems([{ work: night, distanceM: 40 }], SCHAARBEEK, 500);
    expect(item).toMatchObject({ title: "Line 161", tone: "alarm", detail: "Other Type of Restriction · Track A · night, 22:00 to 05:00" });
  });

  test("keeps the three nearest and drops what is beyond the radius", () => {
    const all = found(SCHAARBEEK, 20_000);
    expect(all.length).toBe(5);
    expect(workItems(all, SCHAARBEEK, 20_000)).toHaveLength(3);
    expect(workItems(all, SCHAARBEEK, 500).every((i) => i.title !== "Line 161, near Etterbeek")).toBe(true);
  });

  test("nothing near, and a work without track is skipped", () => {
    expect(workItems([], ETTERBEEK, 1500)).toEqual([]);
    expect(workItems(found(WOLUWE, 1500), WOLUWE, 1500)).toEqual([]);
    expect(workItems([{ work: { ...workAt(0), shape: [] }, distanceM: 10 }], ETTERBEEK, 1500)).toEqual([]);
  });
});
