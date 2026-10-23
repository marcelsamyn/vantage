import { describe, expect, test } from "bun:test";
import { shieldsStatus, topOpenBand } from "./status";
import type { BandReach, CosmicRays, FieldInfo, IonosphereInfo } from "./types";

const km = (n: number): string => `${n.toLocaleString("en-US")} km`;
const band = (name: string, mhz: number, state: BandReach["state"], fromKm = 0): BandReach => ({ name, mhz, state, fromKm, toKm: 4_000 });
const sky = (bands: BandReach[]): IonosphereInfo => ({ main: { code: "RO041", name: "Rome", distanceKm: 11, at: 0, foF2: 4, hmF2: 340, muf3000: 11 }, other: null, bands });
const field = (level: FieldInfo["level"]): FieldInfo => ({ code: "FUR", name: "Fürstenfeldbruck", lat: 0, lon: 0, distanceKm: 700, at: 0, hNt: 21_000, series: [], range3hNt: 10, level, skipped: [] });
const cosmic = (forbush: CosmicRays["forbush"]): CosmicRays => ({ stations: [], forbush, acknowledgement: "" });
const fall = (ongoing: boolean): NonNullable<CosmicRays["forbush"]> => ({ onsetAt: 0, lowAt: 1, depthPct: 8.4, code: "DRBS", untilAt: 2, ongoing });
const night = sky([band("80 m", 3.6, "near"), band("40 m", 7.1, "skip", 1_037), band("30 m", 10.12, "skip", 1_872), band("20 m", 14.2, "closed")]);

describe("shieldsStatus", () => {
  test("a quiet day reads as one line, with the highest open band at its skip distance rounded to 10 km", () => {
    expect(shieldsStatus({ cosmic: cosmic(null), field: field("calm"), sky: night }, km)?.line).toBe("Quiet: cosmic rays normal, field calm, 30 m band open from 1,870 km");
  });

  test("a Forbush decrease that is still going makes the day disturbed", () => {
    const s = shieldsStatus({ cosmic: cosmic(fall(true)), field: field("calm"), sky: night }, km);
    expect(s?.tone).toBe("disturbed");
    expect(s?.line).toStartWith("Disturbed: cosmic rays down 8 %");
  });

  test("a Forbush decrease that has recovered does not", () => {
    expect(shieldsStatus({ cosmic: cosmic(fall(false)), field: field("calm"), sky: night }, km)?.tone).toBe("quiet");
  });

  test("an unsettled field is unsettled, an active one is disturbed", () => {
    expect(shieldsStatus({ cosmic: null, field: field("unsettled"), sky: null }, km)?.tone).toBe("unsettled");
    expect(shieldsStatus({ cosmic: null, field: field("active"), sky: null }, km)?.tone).toBe("disturbed");
  });

  test("a layer that failed to load leaves the line without it, and with none the status is null", () => {
    expect(shieldsStatus({ cosmic: null, field: field("calm"), sky: null }, km)?.line).toBe("Quiet: field calm");
    expect(shieldsStatus({ cosmic: null, field: null, sky: null }, km)).toBeNull();
  });

  test("a band that bounces from overhead is open at any distance; no open band says so", () => {
    expect(shieldsStatus({ cosmic: null, field: null, sky: sky([band("80 m", 3.6, "near"), band("40 m", 7.1, "closed")]) }, km)?.line).toBe("Quiet: 80 m band open at any distance");
    expect(shieldsStatus({ cosmic: null, field: null, sky: sky([band("80 m", 3.6, "closed")]) }, km)?.line).toBe("Quiet: no shortwave band bounces");
  });
});

describe("topOpenBand", () => {
  test("is the open band with the highest frequency", () => {
    expect(topOpenBand(night.bands)?.name).toBe("30 m");
  });
});
