import { HttpError, defineSource, fetchJson, fetchUpstream, json, lat, log, lon, memo, parseQuery, parseUpstream, z } from "../../server/kit";
import { PlanespottersAnswer, adsbdbPhoto, planespottersPhoto } from "./photo.server";
import type { Aircraft, AircraftDetails, AircraftPhoto, AircraftSnapshot, Airline, Airport, WorldwideSnapshot } from "./types";

/**
 * Live aircraft from adsb.lol and adsb.fi, community networks of ADS-B receivers that publish open data.
 * Every aircraft position here is broadcast unencrypted by the aircraft itself.
 * Route, owner and airframe details come from adsbdb.com; airframe photos from Planespotters.net and adsbdb.
 */

const AdsbAircraft = z.object({
  hex: z.string(),
  type: z.string().optional(),
  flight: z.string().optional(),
  r: z.string().optional(),
  t: z.string().optional(),
  desc: z.string().optional(),
  ownOp: z.string().optional(),
  year: z.union([z.string(), z.number()]).optional(),
  lat: z.number().optional(),
  lon: z.number().optional(),
  alt_baro: z.union([z.number(), z.literal("ground")]).optional(),
  alt_geom: z.number().optional(),
  gs: z.number().optional(),
  ias: z.number().optional(),
  tas: z.number().optional(),
  mach: z.number().optional(),
  wd: z.number().optional(),
  ws: z.number().optional(),
  track: z.number().optional(),
  true_heading: z.number().optional(),
  baro_rate: z.number().optional(),
  geom_rate: z.number().optional(),
  nav_altitude_mcp: z.number().optional(),
  nav_altitude_fms: z.number().optional(),
  nav_heading: z.number().optional(),
  nav_modes: z.array(z.string()).optional(),
  squawk: z.string().optional(),
  emergency: z.string().optional(),
  category: z.string().optional(),
  oat: z.number().optional(),
  dbFlags: z.number().optional(),
  seen_pos: z.number().optional(),
});
/** Both networks serve readsb JSON; they differ in the list key and the clock unit. */
const AdsbResponse = z.object({ ac: z.array(AdsbAircraft).optional(), aircraft: z.array(AdsbAircraft).optional(), now: z.number() });

interface Provider {
  name: string;
  url: (lat: number, lon: number, radiusNm: number) => string;
  nextSlot: number;
}

/** adsb.lol first; adsb.fi takes over while adsb.lol is rate-limiting or slow. Both publish open data. */
const PROVIDERS: Provider[] = [
  { name: "adsb.lol", url: (la, lo, r) => `https://api.adsb.lol/v2/point/${la}/${lo}/${r}`, nextSlot: 0 },
  { name: "adsb.fi", url: (la, lo, r) => `https://opendata.adsb.fi/api/v2/lat/${la}/lon/${lo}/dist/${r}`, nextSlot: 0 },
];

/** Bits of readsb's `dbFlags`: military, notable, ICAO Privacy ICAO Address (PIA), FAA Limiting Aircraft Data Displayed (LADD). */
const DB_MILITARY = 1;
const DB_NOTABLE = 2;
const DB_PIA = 4;
const DB_LADD = 8;

/** readsb's `type` names the kind of message that carried the position. */
const POSITION_SOURCES: Record<string, string> = {
  adsb_icao: "ADS-B",
  adsb_icao_nt: "ADS-B",
  adsb_other: "ADS-B",
  adsr_icao: "ADS-R",
  adsr_other: "ADS-R",
  tisb_icao: "TIS-B",
  tisb_other: "TIS-B",
  tisb_trackfile: "TIS-B",
  adsc: "ADS-C",
  mlat: "MLAT",
  mode_s: "Mode S",
};

const text = (value: string | number | null | undefined): string | null => (value === null || value === undefined ? null : String(value).trim() || null);

function normalise(a: z.infer<typeof AdsbAircraft>): Aircraft | null {
  if (a.lat === undefined || a.lon === undefined) return null;
  const onGround = a.alt_baro === "ground";
  const flags = a.dbFlags ?? 0;
  return {
    hex: a.hex.replace(/^~/, "").toLowerCase(),
    callsign: text(a.flight),
    registration: text(a.r),
    typeCode: text(a.t),
    typeName: text(a.desc),
    ownerOperator: text(a.ownOp),
    year: text(a.year),
    lat: a.lat,
    lon: a.lon,
    altFt: onGround ? null : typeof a.alt_baro === "number" ? a.alt_baro : (a.alt_geom ?? null),
    onGround,
    speedKt: a.gs ?? null,
    iasKt: a.ias ?? null,
    tasKt: a.tas ?? null,
    mach: a.mach ?? null,
    trackDeg: a.track ?? a.true_heading ?? null,
    vertRateFpm: a.baro_rate ?? a.geom_rate ?? null,
    selectedAltFt: a.nav_altitude_mcp ?? a.nav_altitude_fms ?? null,
    selectedHeadingDeg: a.nav_heading ?? null,
    autopilotModes: a.nav_modes ?? [],
    windFromDeg: a.wd ?? null,
    windKt: a.ws ?? null,
    squawk: a.squawk ?? null,
    emergency: a.emergency && a.emergency !== "none" ? a.emergency : null,
    category: a.category ?? null,
    outsideAirC: a.oat ?? null,
    military: (flags & DB_MILITARY) !== 0,
    notable: (flags & DB_NOTABLE) !== 0,
    privacyProgramme: flags & DB_LADD ? "FAA LADD" : flags & DB_PIA ? "ICAO PIA" : null,
    positionSource: a.type ? (POSITION_SOURCES[a.type] ?? null) : null,
    posAgeS: a.seen_pos ?? 0,
  };
}

/**
 * Both networks rate-limit bursts, so calls to each start at least GAP_MS apart. When a provider's queue is
 * more than MAX_WAIT_MS deep the call fails fast instead of piling up, and the next provider is tried.
 */
const GAP_MS = 1100;
const MAX_WAIT_MS = 4000;

async function spaced<T>(p: Pick<Provider, "name" | "nextSlot">, task: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const wait = Math.max(0, p.nextSlot - now);
  if (wait > MAX_WAIT_MS) throw new HttpError(503, "upstream_busy", `${p.name} is busy`);
  p.nextSlot = now + wait + GAP_MS;
  if (wait > 0) await Bun.sleep(wait);
  return task();
}

async function fetchAircraft(la: number, lo: number, radiusNm: number): Promise<AircraftSnapshot> {
  let last: unknown;
  for (const p of PROVIDERS) {
    try {
      const d = await spaced(p, () => fetchJson(p.name, p.url(la, lo, radiusNm), AdsbResponse, { timeoutMs: 8000 }));
      const list = d.ac ?? d.aircraft ?? [];
      // adsb.lol reports milliseconds, adsb.fi seconds.
      const fetchedAt = d.now > 1e12 ? d.now : Math.round(d.now * 1000);
      return { fetchedAt, center: { lat: la, lon: lo }, radiusNm, source: p.name, aircraft: list.map(normalise).filter((a): a is Aircraft => a !== null) };
    } catch (err) {
      last = err;
    }
  }
  throw last;
}

// ── Worldwide lists: emergency squawks and military aircraft ──────

/**
 * Worldwide lists get their own queues, apart from the aircraft near you, so a burst of three squawk lookups
 * never delays the live map. Both networks serve the same lists under the same paths.
 */
const WORLD = [
  { name: "adsb.lol", base: "https://api.adsb.lol/v2", nextSlot: 0 },
  { name: "adsb.fi", base: "https://opendata.adsb.fi/api/v2", nextSlot: 0 },
];

async function fetchWorld(path: string): Promise<Aircraft[]> {
  let last: unknown;
  for (const p of WORLD) {
    try {
      const d = await spaced(p, () => fetchJson(p.name, `${p.base}/${path}`, AdsbResponse, { timeoutMs: 15_000 }));
      return (d.ac ?? d.aircraft ?? []).map(normalise).filter((a): a is Aircraft => a !== null);
    } catch (err) {
      last = err;
    }
  }
  throw last;
}

/**
 * 7700 general emergency, 7600 radio failure, 7500 unlawful interference. The three lists are fetched one after
 * another; if one fails the whole answer fails, because a partial list would read as "no emergency".
 */
async function loadEmergencies(): Promise<WorldwideSnapshot> {
  const byHex = new Map<string, Aircraft>();
  for (const code of ["7700", "7600", "7500"]) {
    for (const a of await fetchWorld(`sqk/${code}`)) byHex.set(a.hex, a);
  }
  return { fetchedAt: Date.now(), aircraft: [...byHex.values()] };
}

// ── adsbdb: airframe, owner and route ─────────────────────────────

const HOUR = 3_600_000;
const Hex = z.string().regex(/^[0-9a-f]{6}$/i);

const DbAirport = z.object({
  iata_code: z.string().nullable().optional(),
  icao_code: z.string().nullable().optional(),
  name: z.string(),
  municipality: z.string().nullable().optional(),
  country_name: z.string().nullable().optional(),
  country_iso_name: z.string().nullable().optional(),
  latitude: z.number(),
  longitude: z.number(),
});
const DbAirline = z.object({
  name: z.string(),
  icao: z.string().nullable().optional(),
  iata: z.string().nullable().optional(),
  country: z.string().nullable().optional(),
  callsign: z.string().nullable().optional(),
});
const DbFlightRoute = z.object({
  callsign_icao: z.string().nullable().optional(),
  callsign_iata: z.string().nullable().optional(),
  airline: DbAirline.nullable().optional(),
  origin: DbAirport,
  destination: DbAirport,
});
const DbRoute = z.object({ response: z.union([z.string(), z.object({ flightroute: DbFlightRoute })]) });
const DbAirframe = z.object({
  registration: z.string().nullable().optional(),
  icao_type: z.string().nullable().optional(),
  type: z.string().nullable().optional(),
  manufacturer: z.string().nullable().optional(),
  registered_owner: z.string().nullable().optional(),
  registered_owner_country_name: z.string().nullable().optional(),
  registered_owner_operator_flag_code: z.string().nullable().optional(),
  url_photo_thumbnail: z.string().nullable().optional(),
  url_photo: z.string().nullable().optional(),
});
const DbAircraft = z.object({ response: z.union([z.string(), z.object({ aircraft: DbAirframe })]) });

const toAirport = (a: z.infer<typeof DbAirport>): Airport => ({
  iata: text(a.iata_code),
  icao: text(a.icao_code),
  name: a.name,
  city: text(a.municipality),
  country: text(a.country_name),
  countryCode: text(a.country_iso_name),
  lat: a.latitude,
  lon: a.longitude,
});

const toAirline = (a: z.infer<typeof DbAirline>): Airline => ({
  name: a.name,
  icao: text(a.icao),
  iata: text(a.iata),
  country: text(a.country),
  radioCallsign: text(a.callsign),
});

/** The registry's operator code is an ICAO airline designator for airlines, and something else (often the type) for the rest. */
const airlineCode = (code: string | null): string | null => (code && /^[A-Z]{3}$/.test(code) ? code : null);

/** adsbdb answers 404 with {"response":"unknown …"} for things it does not know; that is "no data", not an error. */
async function adsbdb<S extends z.ZodType>(path: string, schema: S): Promise<z.infer<S> | null> {
  try {
    const res = await fetchUpstream("adsbdb", `https://api.adsbdb.com/v0/${path}`, { timeoutMs: 8000 });
    return parseUpstream("adsbdb", schema, await res.json());
  } catch (err) {
    if (err instanceof HttpError && err.code === "upstream_status") return null;
    throw err;
  }
}

/** The airframe as adsbdb knows it. The profile and the photo lookup share it. */
function airframe(hex: string): Promise<z.infer<typeof DbAirframe> | null> {
  return memo(`adsbdb:aircraft:${hex}`, 6 * HOUR, async () => {
    const found = await adsbdb(`aircraft/${hex}`, DbAircraft);
    return found && typeof found.response === "object" ? found.response.aircraft : null;
  });
}

function flightRoute(callsign: string): Promise<z.infer<typeof DbFlightRoute> | null> {
  return memo(`adsbdb:callsign:${callsign}`, 6 * HOUR, async () => {
    const found = await adsbdb(`callsign/${callsign}`, DbRoute);
    return found && typeof found.response === "object" ? found.response.flightroute : null;
  });
}

function toDetails(a: z.infer<typeof DbAirframe> | null, r: z.infer<typeof DbFlightRoute> | null): AircraftDetails {
  return {
    registration: text(a?.registration),
    typeCode: text(a?.icao_type),
    model: text(a?.type),
    manufacturer: text(a?.manufacturer),
    owner: text(a?.registered_owner),
    ownerCountry: text(a?.registered_owner_country_name),
    ownerAirlineCode: airlineCode(text(a?.registered_owner_operator_flag_code)),
    airline: r?.airline ? toAirline(r.airline) : null,
    flightIcao: text(r?.callsign_icao),
    flightIata: text(r?.callsign_iata),
    origin: r ? toAirport(r.origin) : null,
    destination: r ? toAirport(r.destination) : null,
  };
}

// ── Planespotters.net: airframe photos ────────────────────────────

const PLANESPOTTERS = { name: "Planespotters.net", nextSlot: 0 };
/** Planespotters allows its answers to be kept for 24 hours, and no longer. */
const PHOTO_TTL_MS = 24 * HOUR;

// A line break would end the User-Agent header early, so the raw text is checked first: z.url() quietly strips line
// breaks from its output, and the header uses the raw text.
const Contact = z
  .string()
  .refine((s) => !/[\r\n]/.test(s))
  .pipe(z.union([z.url({ protocol: /^https?$/ }), z.email()]));

/**
 * Planespotters.net answers a server only when its User-Agent says how to reach whoever runs it, so its photos
 * need `VANTAGE_CONTACT` (a web address or an email address). Without it, profiles show adsbdb's photo.
 */
function planespottersAgent(): string | null {
  const contact = process.env["VANTAGE_CONTACT"]?.trim();
  if (!contact) return null;
  if (!Contact.safeParse(contact).success) throw new HttpError(500, "bad_config", "VANTAGE_CONTACT in .env must be a web address or an email address.");
  return `VANTAGE/0.1 (personal open-data dashboard; +${contact})`;
}

async function spottedPhoto(hex: string): Promise<AircraftPhoto | null> {
  const agent = planespottersAgent();
  if (!agent) return null;
  // Kept in memory and never served past its 24 hours, not even when a refresh fails: Planespotters allows no longer.
  return memo(`planespotters:${hex}`, PHOTO_TTL_MS, async () => {
    const answer = await spaced(PLANESPOTTERS, () =>
      fetchJson(PLANESPOTTERS.name, `https://api.planespotters.net/pub/photos/hex/${hex}`, PlanespottersAnswer, { timeoutMs: 8000, headers: { "user-agent": agent } }),
    );
    return planespottersPhoto(answer);
  }, PHOTO_TTL_MS);
}

/**
 * The best photo of this airframe: Planespotters first, because it names the photographer, then adsbdb's, which
 * is asked only when Planespotters has none. A source that fails is logged and skipped, and the answer is then
 * marked unsettled so the browser does not keep a stand-in for an hour.
 */
async function photoOf(hex: string): Promise<{ photo: AircraftPhoto | null; settled: boolean }> {
  let settled = true;
  const skip = (source: string) => (err: unknown): null => {
    if (!(err instanceof HttpError) || err.code === "bad_config") throw err;
    log.warn("aircraft photo lookup failed", { source, hex, error: err.message });
    settled = false;
    return null;
  };
  const spotted = await spottedPhoto(hex).catch(skip("Planespotters.net"));
  if (spotted) return { photo: spotted, settled };
  const frame = await airframe(hex).catch(skip("adsbdb"));
  return { photo: adsbdbPhoto(frame), settled };
}

export default defineSource({
  probes: [
    { name: "Aircraft · adsb.lol", url: "https://api.adsb.lol/v2/point/0/0/1" },
    { name: "Aircraft · adsb.fi", url: "https://opendata.adsb.fi/api/v2/lat/0/lon/0/dist/1" },
    { name: "Aircraft details · adsbdb", url: "https://api.adsbdb.com/v0/online" },
  ],
  routes: {
    "GET /near": async (req) => {
      const q = parseQuery(req, z.object({ lat, lon, radiusNm: z.coerce.number().min(1).max(250).default(60) }));
      // Round the centre so nearby callers share one upstream request.
      const cLat = Math.round(q.lat * 50) / 50;
      const cLon = Math.round(q.lon * 50) / 50;
      const radius = Math.ceil(q.radiusNm / 5) * 5;
      const snapshot = await memo(`adsb:${cLat},${cLon},${radius}`, 4000, () => fetchAircraft(cLat, cLon, radius), 60_000);
      return json(snapshot);
    },

    "GET /emergencies": async () => json(await memo("adsb:emergencies", 45_000, loadEmergencies, 5 * 60_000)),

    "GET /military": async () => json(await memo("adsb:military", 30_000, async (): Promise<WorldwideSnapshot> => ({ fetchedAt: Date.now(), aircraft: await fetchWorld("mil") }), 5 * 60_000)),

    "GET /details": async (req) => {
      const q = parseQuery(req, z.object({ hex: Hex, callsign: z.string().regex(/^[A-Z0-9]{2,8}$/i).optional() }));
      const [a, r] = await Promise.all([airframe(q.hex.toLowerCase()), q.callsign ? flightRoute(q.callsign.toUpperCase()) : null]);
      return json(toDetails(a, r), { maxAge: 3600 });
    },

    "GET /photo": async (req) => {
      const q = parseQuery(req, z.object({ hex: Hex }));
      const { photo, settled } = await photoOf(q.hex.toLowerCase());
      return json(photo, settled ? { maxAge: 3600 } : {});
    },
  },
});
