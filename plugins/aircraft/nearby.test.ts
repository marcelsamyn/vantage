import { describe, expect, test } from "bun:test";
import { overhead, planeItem } from "./nearby";
import type { Aircraft, AircraftPhoto, AircraftSnapshot } from "./types";

const AT = { lat: 50.8467, lon: 4.3525 };
const FETCHED_AT = Date.UTC(2026, 9, 9, 10, 0, 0);

const plane: Aircraft = {
  hex: "4b1814",
  callsign: "SWR123",
  registration: "HB-JCA",
  typeCode: "A20N",
  typeName: "AIRBUS A-320neo",
  ownerOperator: "Swiss",
  year: "2019",
  lat: 50.8467,
  lon: 4.3525,
  altFt: 10_000,
  onGround: false,
  speedKt: 250,
  iasKt: null,
  tasKt: null,
  mach: null,
  trackDeg: 90,
  vertRateFpm: null,
  selectedAltFt: null,
  selectedHeadingDeg: null,
  autopilotModes: [],
  windFromDeg: null,
  windKt: null,
  squawk: null,
  emergency: null,
  category: "A3",
  outsideAirC: null,
  military: false,
  notable: false,
  privacyProgramme: null,
  positionSource: "ADS-B",
  posAgeS: 1,
};
const snapshot: AircraftSnapshot = { fetchedAt: FETCHED_AT, source: "adsb.lol", center: AT, radiusNm: 25, aircraft: [plane, { ...plane, hex: "aaaaaa", onGround: true, altFt: null }] };
const photo: AircraftPhoto = { src: "https://img.example/big.jpg", thumb: "https://img.example/small.jpg", photographer: null, source: "Planespotters.net", link: "https://img.example/page" };

describe("planeItem", () => {
  test("an aircraft overhead is something to see: Follow it opens the profile", () => {
    const [o] = overhead(snapshot, AT, FETCHED_AT);
    expect(o).toBeDefined();
    const item = planeItem(o!, FETCHED_AT, "metric", photo);
    expect(item).toMatchObject({ kind: "see", at: "overhead", live: true, title: "SWR123", image: photo.thumb, primary: { label: "Follow it" } });
    expect(item.more).toBeUndefined();
  });

  test("leaves grounded aircraft out and the picture off when there is none", () => {
    const planes = overhead(snapshot, AT, FETCHED_AT);
    expect(planes.map((o) => o.aircraft.hex)).toEqual(["4b1814"]);
    expect(planeItem(planes[0]!, FETCHED_AT, "imperial", null)).not.toHaveProperty("image");
  });
});
