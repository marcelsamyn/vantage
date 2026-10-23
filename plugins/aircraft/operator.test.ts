import { describe, expect, test } from "bun:test";
import { emergencyOf } from "./emergency";
import { describeAircraft } from "./operator";

const heli = { category: "A7", typeCode: "A139", military: false };
const plane = { category: "A1", typeCode: "C172", military: false };

describe("describeAircraft", () => {
  test("names a public body the way the registry does", () => {
    expect(describeAircraft(heli, { owner: "Polizia di Stato" })).toBe("Polizia di Stato helicopter");
    expect(describeAircraft(plane, { owner: "Metropolitan Police Service" })).toBe("Metropolitan Police Service aircraft");
  });

  test("reads the role from the operator", () => {
    expect(describeAircraft(plane, { owner: "Aerofotogrammetria Nistri S.p.A." })).toBe("survey aircraft");
    expect(describeAircraft(heli, { owner: "Babcock Air Ambulance Ltd" })).toBe("air ambulance helicopter");
    expect(describeAircraft(heli, { owner: "Sky News Helicopters" })).toBe("news helicopter");
    expect(describeAircraft(plane, { owner: "Aero Club di Roma" })).toBe("training aircraft");
  });

  test("gives no role to an owner with none in the name", () => {
    expect(describeAircraft(plane, { owner: "John Smith" })).toBe("an aircraft");
    expect(describeAircraft(heli, { owner: "John Smith" })).toBe("a helicopter");
    expect(describeAircraft(plane, undefined)).toBe("an aircraft");
  });

  test("military is read from the transponder flag", () => {
    expect(describeAircraft({ ...plane, military: true }, undefined)).toBe("military aircraft");
  });
});

describe("emergencyOf", () => {
  test("reads the three codes and rejects the lookalikes", () => {
    expect(emergencyOf({ squawk: "7700", emergency: null })?.title).toBe("General emergency");
    expect(emergencyOf({ squawk: "7600", emergency: null })?.title).toBe("Radio failure");
    expect(emergencyOf({ squawk: "7500", emergency: null })?.title).toBe("Unlawful interference");
    expect(emergencyOf({ squawk: "7000", emergency: null })).toBeNull();
    expect(emergencyOf({ squawk: "1200", emergency: "lifeguard" })).toBeNull();
    expect(emergencyOf({ squawk: "2000", emergency: "minfuel" })).toBeNull();
  });

  test("falls back to the ADS-B emergency field when the squawk is something else", () => {
    expect(emergencyOf({ squawk: "4321", emergency: "general" })?.code).toBe("7700");
    expect(emergencyOf({ squawk: null, emergency: "nordo" })?.code).toBe("7600");
    expect(emergencyOf({ squawk: null, emergency: "unlawful" })?.code).toBe("7500");
  });
});
