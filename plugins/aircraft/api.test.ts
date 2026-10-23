import { afterEach, describe, expect, test } from "bun:test";
import type { BunRequest } from "bun";
import api from "./api";
import type { AircraftDetails, AircraftPhoto, AircraftSnapshot } from "./types";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env["VANTAGE_CONTACT"];
});

let seen: { url: string; agent: string | null }[] = [];

/** Stands in for the upstream services: adsb.lol, adsbdb and Planespotters. `undefined` answers like adsbdb's 404. */
function upstream(answer: (url: string) => unknown): void {
  seen = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    seen.push({ url, agent: new Headers(init?.headers).get("user-agent") });
    const body = answer(url);
    if (body instanceof Response) return body;
    return body === undefined ? Response.json({ response: "unknown aircraft" }, { status: 404 }) : Response.json(body);
  }) as unknown as typeof fetch;
}

async function respond(path: `/${string}`): Promise<Response> {
  const route = path.split("?")[0] ?? path;
  const handler = api.routes[`GET /${route.slice(1)}`];
  if (!handler) throw new Error(`the aircraft API should serve ${route}`);
  return handler(new Request(`http://127.0.0.1/api/aircraft${path}`) as BunRequest<string>);
}

async function call<T>(path: `/${string}`): Promise<T> {
  return (await (await respond(path)).json()) as T;
}

describe("/near", () => {
  test("keeps callsigns, owners and every flight field the receiver network publishes", async () => {
    upstream(() => ({
      now: 1_791_550_000_000,
      ac: [
        {
          hex: "4ca7b4",
          type: "adsb_icao",
          flight: "RYR1JW  ",
          r: "EI-EFY",
          t: "B738",
          desc: "BOEING 737-800",
          ownOp: "Ryanair",
          year: 2009,
          lat: 41.95,
          lon: 12.41,
          alt_baro: 37_800,
          gs: 463.1,
          ias: 243,
          tas: 440,
          mach: 0.768,
          wd: 186,
          ws: 31,
          oat: -57,
          track: 40.5,
          baro_rate: 0,
          nav_altitude_mcp: 38_016,
          nav_heading: 37.97,
          nav_modes: ["autopilot", "tcas"],
          squawk: "1265",
          category: "A3",
          dbFlags: 2,
          seen_pos: 0.3,
        },
        { hex: "~a1b2c3", type: "mlat", flight: "N123AB  ", r: "N123AB", t: "C172", lat: 41.9, lon: 12.5, alt_baro: 2500, dbFlags: 8 },
        { hex: "3c6444", type: "adsb_icao", lat: 41.8, lon: 12.6, alt_baro: "ground", dbFlags: 4 },
      ],
    }));
    const snapshot = await call<AircraftSnapshot>("/near?lat=41.9&lon=12.5&radiusNm=40");
    const [airliner, cessna, hidden] = snapshot.aircraft;
    expect(airliner).toMatchObject({
      hex: "4ca7b4",
      callsign: "RYR1JW",
      registration: "EI-EFY",
      typeCode: "B738",
      typeName: "BOEING 737-800",
      ownerOperator: "Ryanair",
      year: "2009",
      iasKt: 243,
      tasKt: 440,
      mach: 0.768,
      windFromDeg: 186,
      windKt: 31,
      selectedAltFt: 38_016,
      selectedHeadingDeg: 37.97,
      autopilotModes: ["autopilot", "tcas"],
      notable: true,
      privacyProgramme: null,
      positionSource: "ADS-B",
    });
    expect(cessna).toMatchObject({ hex: "a1b2c3", callsign: "N123AB", registration: "N123AB", privacyProgramme: "FAA LADD", positionSource: "MLAT", autopilotModes: [] });
    expect(hidden).toMatchObject({ hex: "3c6444", onGround: true, privacyProgramme: "ICAO PIA", callsign: null });
  });
});

describe("/details", () => {
  test("names the registered owner as the registry does, person or organisation", async () => {
    upstream((url) =>
      url.endsWith("/aircraft/a1b2c4")
        ? { response: { aircraft: { registration: "N123AB", icao_type: "C172", type: "172S", manufacturer: "Cessna", registered_owner: "SMITH JOHN R", registered_owner_country_name: "United States", registered_owner_operator_flag_code: "C172" } } }
        : undefined,
    );
    const details = await call<AircraftDetails>("/details?hex=a1b2c4&callsign=N123AB");
    expect(details).toMatchObject({ registration: "N123AB", typeCode: "C172", owner: "SMITH JOHN R", ownerCountry: "United States", ownerAirlineCode: null, airline: null, origin: null });
  });

  test("carries the airline, its radio callsign and both flight numbers", async () => {
    upstream((url) => {
      if (url.endsWith("/aircraft/48c2a9")) return { response: { aircraft: { registration: "SP-RZK", registered_owner: "Buzz", registered_owner_operator_flag_code: "RYS" } } };
      if (url.endsWith("/callsign/RYR1JW")) {
        const airport = (iata: string, city: string): unknown => ({ iata_code: iata, icao_code: null, name: `${city} Airport`, municipality: city, country_name: "Italy", country_iso_name: "IT", latitude: 39.25, longitude: 9.05 });
        return {
          response: {
            flightroute: {
              callsign_icao: "RYR1JW",
              callsign_iata: "FR1JW",
              airline: { name: "Ryanair", icao: "RYR", iata: "FR", country: "Ireland", callsign: "RYANAIR" },
              origin: airport("CAG", "Cagliari"),
              destination: airport("BUD", "Budapest"),
            },
          },
        };
      }
      return undefined;
    });
    const details = await call<AircraftDetails>("/details?hex=48c2a9&callsign=ryr1jw");
    expect(details).toMatchObject({
      owner: "Buzz",
      ownerAirlineCode: "RYS",
      flightIcao: "RYR1JW",
      flightIata: "FR1JW",
      airline: { name: "Ryanair", icao: "RYR", iata: "FR", country: "Ireland", radioCallsign: "RYANAIR" },
      origin: { iata: "CAG", city: "Cagliari", countryCode: "IT" },
    });
  });
});

describe("/photo", () => {
  const adsbdbAnswer = (photos: { url_photo?: string; url_photo_thumbnail?: string }): unknown => ({ response: { aircraft: { registration: "EI-EFY", ...photos } } });
  const spottedAnswer = {
    photos: [
      {
        id: "1702451",
        thumbnail: { src: "https://t.plnspttrs.net/38209/1702451_6a1b4c2f9e_t.jpg", size: { width: 200, height: 133 } },
        thumbnail_large: { src: "https://t.plnspttrs.net/38209/1702451_6a1b4c2f9e_280.jpg", size: { width: 420, height: 280 } },
        link: "https://www.planespotters.net/photo/1702451/ei-efy-ryanair-boeing-737-8as-wl",
        photographer: "Jan Peeters",
      },
    ],
  };
  const airportData = { url_photo: "https://image.airport-data.com/aircraft/001485347.jpg", url_photo_thumbnail: "https://airport-data.com/images/aircraft/thumbnails/001/485/001485347.jpg" };

  test("without a contact, Planespotters is not asked and adsbdb's photo comes with its page", async () => {
    upstream((url) => (url.includes("adsbdb") ? adsbdbAnswer(airportData) : undefined));
    const photo = await call<AircraftPhoto | null>("/photo?hex=aaaaa1");
    expect(photo).toMatchObject({ source: "Airport-Data.com", src: airportData.url_photo, link: "https://airport-data.com/aircraft/photo/001485347" });
    expect(seen.some((s) => s.url.includes("planespotters"))).toBe(false);
  });

  test("a photo address reaches the browser only if it is http(s)", async () => {
    upstream(() => adsbdbAnswer({ url_photo_thumbnail: "javascript:alert(1)", url_photo: "data:text/html,<script>1</script>" }));
    expect(await call<AircraftPhoto | null>("/photo?hex=aaaaa2")).toBeNull();
  });

  test("with a contact, Planespotters' photo comes first and the request says how to reach whoever runs VANTAGE", async () => {
    process.env["VANTAGE_CONTACT"] = "https://example.org/vantage-contact";
    upstream((url) => (url.includes("planespotters") ? spottedAnswer : adsbdbAnswer(airportData)));
    const photo = await call<AircraftPhoto | null>("/photo?hex=AAAAB1");
    expect(photo).toMatchObject({ source: "Planespotters.net", photographer: "Jan Peeters", link: spottedAnswer.photos[0]?.link });
    const asked = seen.find((s) => s.url.includes("planespotters"));
    expect(asked?.url).toBe("https://api.planespotters.net/pub/photos/hex/aaaab1");
    expect(asked?.agent).toContain("+https://example.org/vantage-contact");
  });

  test("when Planespotters has no photo of the airframe, adsbdb's is used", async () => {
    process.env["VANTAGE_CONTACT"] = "spotting@example.org";
    upstream((url) => (url.includes("planespotters") ? { photos: [] } : adsbdbAnswer(airportData)));
    expect((await call<AircraftPhoto | null>("/photo?hex=aaaab2"))?.source).toBe("Airport-Data.com");
  });

  test("while Planespotters is rate limiting, adsbdb's photo is used", async () => {
    process.env["VANTAGE_CONTACT"] = "spotting@example.org";
    upstream((url) => (url.includes("planespotters") ? new Response("slow down", { status: 429 }) : adsbdbAnswer(airportData)));
    expect((await call<AircraftPhoto | null>("/photo?hex=aaaab3"))?.source).toBe("Airport-Data.com");
  });

  test("when adsbdb fails, Planespotters' photo still comes through and adsbdb is not asked at all", async () => {
    process.env["VANTAGE_CONTACT"] = "spotting@example.org";
    upstream((url) => (url.includes("planespotters") ? spottedAnswer : new Response("down", { status: 503 })));
    const res = await respond("/photo?hex=aaaab5");
    expect(((await res.json()) as AircraftPhoto | null)?.source).toBe("Planespotters.net");
    expect(seen.some((s) => s.url.includes("adsbdb"))).toBe(false);
    expect(res.headers.get("cache-control")).toContain("max-age=3600");
  });

  test("a stand-in answer while a source fails is not kept by the browser", async () => {
    process.env["VANTAGE_CONTACT"] = "spotting@example.org";
    upstream((url) => (url.includes("planespotters") ? new Response("slow down", { status: 429 }) : adsbdbAnswer(airportData)));
    const res = await respond("/photo?hex=aaaab6");
    expect(((await res.json()) as AircraftPhoto | null)?.source).toBe("Airport-Data.com");
    expect(res.headers.get("cache-control") ?? "").not.toContain("max-age=3600");
  });

  test("a web-address contact with a line break in it is a configuration error, not a failed request", async () => {
    process.env["VANTAGE_CONTACT"] = "https://example.org/\r\nX-Injected: 1";
    upstream(() => adsbdbAnswer(airportData));
    await expect(call("/photo?hex=aaaab7")).rejects.toThrow("VANTAGE_CONTACT");
  });

  test("a contact that is neither a web address nor an email address is a configuration error", async () => {
    process.env["VANTAGE_CONTACT"] = "call me\r\nX-Injected: 1";
    upstream(() => adsbdbAnswer(airportData));
    await expect(call("/photo?hex=aaaab4")).rejects.toThrow("VANTAGE_CONTACT");
  });
});
