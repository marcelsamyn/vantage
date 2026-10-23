import { describe, expect, test } from "bun:test";
import { companyLink, flightLink, registrationLink, trackerLink, typeLink } from "./links";

describe("flightLink", () => {
  test("opens the flight on FlightAware, whatever the padding or case", () => {
    expect(flightLink("RYR1JW  ")).toBe("https://www.flightaware.com/live/flight/RYR1JW");
    expect(flightLink(" ryr1jw")).toBe("https://www.flightaware.com/live/flight/RYR1JW");
    expect(flightLink("N 323AS")).toBe("https://www.flightaware.com/live/flight/N323AS");
  });

  test("gives no link for callsigns that name no flight", () => {
    expect(flightLink("00000")).toBeNull();
    expect(flightLink("RYR-1JW")).toBeNull();
    expect(flightLink("ABCDEFGHI")).toBeNull();
    expect(flightLink("../admin")).toBeNull();
    expect(flightLink("")).toBeNull();
    expect(flightLink(null)).toBeNull();
  });
});

describe("registrationLink", () => {
  test("opens the FAA record for US registrations, with spaces and lowercase removed", () => {
    const faa = "https://registry.faa.gov/AircraftInquiry/Search/NNumberResult?NNumbertxt=N323AS";
    expect(registrationLink("N323AS", "a37986")).toBe(faa);
    expect(registrationLink("n323as", "a37986")).toBe(faa);
    expect(registrationLink(" N 323 AS ", "a37986")).toBe(faa);
  });

  test("opens the airframe on Planespotters for every other registration", () => {
    expect(registrationLink("EC-MQP", "3453cc")).toBe("https://www.planespotters.net/hex/3453CC");
    expect(registrationLink("ec mqp", "3453cc")).toBe("https://www.planespotters.net/hex/3453CC");
    // "N0…" is no US registration: US numbers never start with a zero.
    expect(registrationLink("N0123", "3453cc")).toBe("https://www.planespotters.net/hex/3453CC");
    expect(registrationLink("MM81839", "320016")).toBe("https://www.planespotters.net/hex/320016");
  });

  test("gives no link without a registration or a valid address", () => {
    expect(registrationLink(null, "3453cc")).toBeNull();
    expect(registrationLink("  ", "3453cc")).toBeNull();
    expect(registrationLink("EC-MQP", "3453c")).toBeNull();
    expect(registrationLink("EC-MQP", "zzzzzz")).toBeNull();
  });
});

describe("typeLink", () => {
  test("opens the type on SKYbrary by its designator", () => {
    expect(typeLink("B38M")).toBe("https://skybrary.aero/aircraft/b38m");
    expect(typeLink(" a139 ")).toBe("https://skybrary.aero/aircraft/a139");
    expect(typeLink("H60")).toBe("https://skybrary.aero/aircraft/h60");
  });

  test("gives no link for pseudo types and odd values", () => {
    expect(typeLink("GND")).toBeNull();
    expect(typeLink("TWR")).toBeNull();
    expect(typeLink("1234")).toBeNull();
    expect(typeLink("B738/W")).toBeNull();
    expect(typeLink(null)).toBeNull();
  });
});

describe("companyLink", () => {
  test("opens an airline's fleet on FlightAware when its ICAO designator is known", () => {
    expect(companyLink("Ryanair", "RYR")).toBe("https://www.flightaware.com/live/fleet/RYR");
    expect(companyLink("Air Europa", " aea")).toBe("https://www.flightaware.com/live/fleet/AEA");
  });

  test("searches company registers on OpenCorporates for every other owner", () => {
    expect(companyLink("Alc Blarney Aircraft Limited", null)).toBe("https://opencorporates.com/companies?q=Alc+Blarney+Aircraft+Limited");
    expect(companyLink("  SMITH   JOHN R ", null)).toBe("https://opencorporates.com/companies?q=SMITH+JOHN+R");
    expect(companyLink("A&B Leasing #2", "A139")).toBe("https://opencorporates.com/companies?q=A%26B+Leasing+%232");
  });

  test("gives no link without a name or a code", () => {
    expect(companyLink(null, null)).toBeNull();
    expect(companyLink(" ", null)).toBeNull();
  });
});

test("trackerLink opens the aircraft on ADS-B Exchange", () => {
  expect(trackerLink("3453CC")).toBe("https://globe.adsbexchange.com/?icao=3453cc");
  expect(trackerLink("~3453cc")).toBeNull();
});
