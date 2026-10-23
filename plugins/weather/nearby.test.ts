import { describe, expect, test } from "bun:test";
import { warningItems } from "./nearby";
import type { OfficialWarning } from "./types";

const warning = (id: string, level: OfficialWarning["level"], url: string | null): OfficialWarning => ({
  id,
  source: "meteoalarm",
  level,
  hazard: "Thunderstorms",
  area: "Brussels-Capital",
  country: "BE",
  issuer: "KMI-IRM",
  from: 1_791_540_000,
  until: 1_791_562_800,
  text: null,
  advice: null,
  url,
  municipalityCount: null,
  areaId: null,
});

describe("warningItems", () => {
  test("a warning is something to see: What to do opens it, the official notice comes after", () => {
    const [item] = warningItems([warning("w1", "orange", "https://www.meteo.be/warning")]);
    expect(item).toMatchObject({ kind: "see", at: "here", tone: "alarm", title: "Orange warning: Thunderstorms", primary: { label: "What to do" } });
    expect(item?.more?.map((a) => a.label)).toEqual(["Official notice"]);
  });

  test("keeps the two strongest and offers no notice without a link", () => {
    const items = warningItems([warning("w1", "red", null), warning("w2", "orange", null), warning("w3", "yellow", null)]);
    expect(items.map((i) => i.id)).toEqual(["w1", "w2"]);
    expect(items[0]?.more).toEqual([]);
  });
});
