import { expect, test } from "bun:test";
import { vehicleList } from "./gbfs";
import { vehicleThings } from "./things";
import type { FreeVehicle } from "./types";

const vehicle = (over: Partial<FreeVehicle> = {}): FreeVehicle => ({
  id: "tier_rome~abc",
  systemId: "tier_rome",
  systemName: "TIER Rome",
  operator: "TIER",
  lat: 41.9,
  lon: 12.5,
  form: "scooter_standing",
  formName: "Scooter",
  propulsion: "electric",
  typeName: null,
  planId: null,
  rangeM: 18_400,
  maxRangeKm: 40,
  charge: 0.62,
  rentalUrl: null,
  ...over,
});

test("a vehicle is labelled with what it is and how charged it is, which is no name of its own", () => {
  const [thing] = vehicleThings([vehicle()]);
  expect(thing?.label).toBe("Scooter, 62% charged");
  expect(thing?.name).toBeNull();
  expect(thing?.variant).toBe("scooter");
  expect(thing?.state).toBe("ok");
  expect(thing?.rows).toContainEqual(["Range left", "18.4 km"]);
});

test("the battery decides the state, so a flat scooter never looks ready", () => {
  expect(vehicleThings([vehicle({ charge: 0.3 })])[0]?.state).toBe("low");
  expect(vehicleThings([vehicle({ charge: 0.05 })])[0]?.state).toBe("out");
  expect(vehicleThings([vehicle({ charge: null })])[0]?.state).toBe("unknown");
});

test("a range the operator reports above its own type's maximum is left out", () => {
  const rows = vehicleThings([vehicle({ rangeM: 60_000, maxRangeKm: 40 })])[0]?.rows ?? [];
  expect(rows.map(([label]) => label)).not.toContain("Range when full");
});

test("renting is offered only where the operator publishes a link for it", () => {
  expect(vehicleThings([vehicle()])[0]?.actions).toEqual([]);
  expect(vehicleThings([vehicle({ rentalUrl: "https://tier.app/rent/abc" })])[0]?.actions).toEqual([{ label: "Rent now", href: "https://tier.app/rent/abc" }]);
});

test("a feed's rental links are read, and app-only schemes are left behind", () => {
  const [web, app, scheme] = vehicleList({
    data: {
      bikes: [
        { bike_id: "a", lat: 41.9, lon: 12.5, rental_uris: { android: "https://go.example/a", web: "https://example.org/a" } },
        { bike_id: "b", lat: 41.9, lon: 12.5, rental_uris: { android: "https://go.example/b" } },
        { bike_id: "c", lat: 41.9, lon: 12.5, rental_uris: { ios: "tier://rent/c" } },
      ],
    },
  });
  expect(web?.rentalUrl).toBe("https://example.org/a");
  expect(app?.rentalUrl).toBe("https://go.example/b");
  expect(scheme?.rentalUrl).toBeNull();
});
