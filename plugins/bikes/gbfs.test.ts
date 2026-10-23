import { describe, expect, test } from "bun:test";
import { boxOf, feedUrls, localized, parseCatalogue, parseCsv, pricingLines, systemInformation, vehicleList, vehicleTypes } from "./gbfs";

describe("catalogue", () => {
  const csv = [
    "Country Code,Name,Location,System ID,URL,Auto-Discovery URL,Supported Versions,Authentication Info URL,Authentication Type,Authentication Parameter Name",
    "IT,Bird Rome,Rome,bird-rome,https://www.bird.co/,https://mds.bird.co/gbfs/v2/public/rome/gbfs.json,1.1 ; 2.3,,,",
    'IT,Dott Cagliari,"Cagliari, IT",https://ridedott.com/,https://gbfs.api.ridedott.com/public/v2/cagliari/gbfs.json',
    "IT,Broken,Nowhere,broken,https://x.example/,not a url,2.3,,,",
    'BE,"Quote ""Co""",Brussels,quote-co,https://q.example/,https://q.example/gbfs.json,3.0,,,',
  ].join("\r\n");

  test("reads the columns by name and skips rows without a usable discovery URL", () => {
    const entries = parseCatalogue(csv);
    // The Cagliari row in the real catalogue has a missing column, so its discovery URL is not where the header says; it is skipped.
    expect(entries.map((e) => e.id)).toEqual(["bird-rome", "quote-co"]);
    expect(entries[0]).toEqual({ country: "IT", name: "Bird Rome", location: "Rome", id: "bird-rome", discoveryUrl: "https://mds.bird.co/gbfs/v2/public/rome/gbfs.json" });
    expect(entries[1]?.name).toBe('Quote "Co"');
  });

  test("a quoted comma stays in its field", () => {
    expect(parseCsv('a,"b, c",d\n1,2,3')).toEqual([
      ["a", "b, c", "d"],
      ["1", "2", "3"],
    ]);
  });

  test("a file with a different header gives nothing instead of wrong columns", () => {
    expect(parseCatalogue("x,y\n1,2")).toEqual([]);
  });
});

describe("discovery", () => {
  test("v2 lists feeds per language", () => {
    const urls = feedUrls({ data: { en: { feeds: [{ name: "free_bike_status", url: "https://a/free.json" }, { name: "system_pricing_plans", url: "https://a/plans.json" }] } } });
    expect(urls).toEqual({ free_bike_status: "https://a/free.json", system_pricing_plans: "https://a/plans.json" });
  });

  test("v2 with only a non-English language still works", () => {
    expect(feedUrls({ data: { it: { feeds: [{ name: "free_bike_status", url: "https://a/f.json" }] } } })).toEqual({ free_bike_status: "https://a/f.json" });
  });

  test("v3 has one list", () => {
    expect(feedUrls({ data: { feeds: [{ name: "vehicle_status", url: "https://a/v.json" }] } })).toEqual({ vehicle_status: "https://a/v.json" });
  });

  test("anything else gives no feeds", () => {
    expect(feedUrls(null)).toEqual({});
    expect(feedUrls({ error: "Not Found" })).toEqual({});
  });
});

describe("vehicles", () => {
  test("v2 free_bike_status: range in metres, charge as a share, reserved and disabled left out", () => {
    const vehicles = vehicleList({
      data: {
        bikes: [
          { bike_id: "a", lat: 41.9189, lon: 12.5443, is_disabled: false, is_reserved: false, vehicle_type_id: "t1", current_range_meters: 31680, current_fuel_percent: 0.7096774 },
          { bike_id: "b", lat: 41.9, lon: 12.5, is_disabled: false, is_reserved: true },
          { bike_id: "c", lat: 41.9, lon: 12.5, is_disabled: true },
          { bike_id: 77, lat: 41.91, lon: 12.51 },
          { bike_id: "nowhere", lat: 0, lon: 0 },
          { bike_id: "no-position" },
        ],
      },
    });
    expect(vehicles.map((v) => v.id)).toEqual(["a", "77"]);
    expect(vehicles[0]).toMatchObject({ typeId: "t1", rangeM: 31680, charge: 0.7096774 });
    expect(vehicles[1]).toMatchObject({ typeId: null, rangeM: null, charge: null });
  });

  test("v3 vehicle_status uses vehicle_id", () => {
    expect(vehicleList({ data: { vehicles: [{ vehicle_id: "v1", lat: 50.85, lon: 4.35, vehicle_type_id: "kick" }] } }).map((v) => v.id)).toEqual(["v1"]);
  });

  test("an empty or failed feed gives no vehicles", () => {
    expect(vehicleList({ data: { bikes: [] } })).toEqual([]);
    expect(vehicleList({ error: "x" })).toEqual([]);
  });

  test("vehicle types map form factor and propulsion; unknown form factors become other", () => {
    const types = vehicleTypes({
      data: {
        vehicle_types: [
          { vehicle_type_id: "e", form_factor: "scooter_standing", propulsion_type: "electric", max_range_meters: 40000, name: [{ text: "E-scooter", language: "en" }] },
          { vehicle_type_id: "x", form_factor: "hoverboard", propulsion_type: "electric" },
        ],
      },
    });
    expect(types.get("e")).toEqual({ form: "scooter_standing", propulsion: "electric", maxRangeM: 40000, name: "E-scooter" });
    expect(types.get("x")?.form).toBe("other");
  });

  test("the service area ignores a stray vehicle far away", () => {
    const rome = Array.from({ length: 100 }, (_, i) => ({ lat: 41.85 + i * 0.001, lon: 12.45 + i * 0.001 }));
    const box = boxOf([...rome, { lat: 52, lon: 5 }]);
    expect(box?.north).toBeLessThan(42);
    expect(boxOf([])).toBeNull();
  });
});

describe("pricing", () => {
  test("v3 plan with per-minute pricing", () => {
    const lines = pricingLines({ data: { plans: [{ plan_id: "b", name: [{ text: "Basic bike", language: "en" }], currency: "EUR", price: 0, per_min_pricing: [{ start: 0, rate: 0.28, interval: 1 }] }] } });
    expect(lines).toEqual(["Basic bike: no unlock fee, €0.28 per minute"]);
  });

  test("v2 plan with unlock fee and per-km pricing", () => {
    const lines = pricingLines({ data: { plans: [{ plan_id: "p", name: "Ride", currency: "EUR", price: 1, per_km_pricing: [{ start: 0, rate: 0.5, interval: 1 }] }] } });
    expect(lines).toEqual(["Ride: €1 to unlock, €0.50 per km"]);
  });

  test("a plan with only a description shows it, and no plans gives no lines", () => {
    expect(pricingLines({ data: { plans: [{ plan_id: "d", name: "Day pass", description: "Unlimited rides for 24 hours." }] } })).toEqual(["Day pass: Unlimited rides for 24 hours."]);
    expect(pricingLines({ data: { plans: [] } })).toEqual([]);
  });

  test("localized text prefers English", () => {
    expect(localized([{ text: "Ciao", language: "it" }, { text: "Hello", language: "en" }])).toBe("Hello");
    expect(localized([{ text: "Ciao", language: "it" }])).toBe("Ciao");
    expect(localized("plain")).toBe("plain");
    expect(localized(undefined)).toBeNull();
  });
});

describe("system information", () => {
  test("a v2 feed names its operator and itself", () => {
    // Bird Rome, as it answers: plain strings, beside a record the reader must not mistake for them.
    const feed = {
      version: "2.3",
      data: { system_id: "bird-rome", name: "bird rome", operator: "Bird Rides, Inc.", timezone: "Europe/Rome", rental_apps: { ios: { store_uri: "https://apps.apple.com/" } } },
    };
    expect(systemInformation(feed)).toEqual({ operator: "Bird Rides, Inc.", systemName: "bird rome" });
  });

  test("a v3 feed names itself in the reader's language", () => {
    const feed = {
      version: "3.0",
      data: {
        system_id: "velib",
        name: [{ language: "fr", text: "Vélib' Métropole" }, { language: "en", text: "Velib Metropole" }],
        operator: [{ language: "fr", text: "Smovengo" }],
      },
    };
    expect(systemInformation(feed)).toEqual({ operator: "Smovengo", systemName: "Velib Metropole" });
  });

  test("a feed that says neither gives nothing to show", () => {
    expect(systemInformation({ data: { system_id: "x", timezone: "Europe/Rome" } })).toEqual({ operator: null, systemName: null });
    expect(systemInformation({ nope: true })).toEqual({ operator: null, systemName: null });
  });
});
