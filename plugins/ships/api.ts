import { HttpError, defineSource, fetchJson, json, log, memo, parseQuery, parseUpstream, z } from "../../server/kit";
import type { AisStatic } from "./ais-decoder";
import { GlobalAisStream, type GlobalReport, type GlobalTrackedVessel } from "./aisstream";
import { AisStream, type TrackedVessel } from "./ais-stream";
import type { ShipDetails, ShipSource, ShipsNear, Vessel } from "./types";
import { categoryOf, etaMs, flagOf, unpackEta } from "./vessel";

/** Nordic HTTP/TCP feeds and an optional AIS Stream subscription for the requested areas. */

const DIGITRAFFIC = "https://meri.digitraffic.fi/api/ais/v1";
const DIGITRAFFIC_HEADERS = { "Digitraffic-User": "VANTAGE/1.0" };
const MAX_AGE_MS = 20 * 60_000;
const MAX_VESSELS = 3000;

/** Where each source can have ships. A view outside its box does not wake the source. */
const FINLAND_BOX = { west: 9, south: 53, east: 32, north: 70 };
const NORWAY_BOX = { west: -12, south: 55, east: 35, north: 82 };

interface Box {
  west: number;
  south: number;
  east: number;
  north: number;
}

const intersects = (a: Box, b: Box): boolean => a.west <= b.east && a.east >= b.west && a.south <= b.north && a.north >= b.south;

let norway: AisStream | null = null;
/** Created on first use, so the stream's timer does not exist until someone opens ships. */
const norwegianStream = (): AisStream => (norway ??= new AisStream({ host: "153.44.253.27", port: 5631, onProblem: (message) => log.warn("Norwegian AIS stream problem", { message }) }));

const clean = (s: string | null | undefined): string | null => {
  const t = s?.replace(/@+$/, "").trim();
  return t ? t : null;
};

// ── Digitraffic ───────────────────────────────────────────────────

const Locations = z.object({
  features: z.array(
    z.object({
      mmsi: z.number(),
      geometry: z.object({ coordinates: z.tuple([z.number(), z.number()]) }),
      properties: z.object({ sog: z.number(), cog: z.number(), navStat: z.number(), heading: z.number(), timestampExternal: z.number() }),
    }),
  ),
});
type Location = z.infer<typeof Locations>["features"][number];

const Registry = z.array(
  z.object({
    mmsi: z.number(),
    name: z.string().nullable().optional(),
    callSign: z.string().nullable().optional(),
    imo: z.number().nullable().optional(),
    shipType: z.number().nullable().optional(),
    destination: z.string().nullable().optional(),
    draught: z.number().nullable().optional(),
    eta: z.number().nullable().optional(),
    referencePointA: z.number().nullable().optional(),
    referencePointB: z.number().nullable().optional(),
    referencePointC: z.number().nullable().optional(),
    referencePointD: z.number().nullable().optional(),
  }),
);
type RegistryEntry = z.infer<typeof Registry>[number];
type RegistryMap = Map<number, RegistryEntry>;

const finnishRegistry = (): Promise<RegistryMap> =>
  memo(
    "ships:digitraffic:vessels",
    3_600_000,
    async () => new Map((await fetchJson("Digitraffic Marine", `${DIGITRAFFIC}/vessels`, Registry, { headers: DIGITRAFFIC_HEADERS, timeoutMs: 25_000 })).map((v) => [v.mmsi, v])),
    12 * 3_600_000,
  );

const finnishLocations = (): Promise<Location[]> =>
  memo("ships:digitraffic:locations", 30_000, async () => (await fetchJson("Digitraffic Marine", `${DIGITRAFFIC}/locations`, Locations, { headers: DIGITRAFFIC_HEADERS, timeoutMs: 25_000 })).features, 5 * 60_000);

/** Without the registry the ships still show, just without names and types. */
const registryOrEmpty = (): Promise<RegistryMap> => finnishRegistry().catch(() => new Map());

function finnishVessel(f: Location, meta: RegistryEntry | undefined): Vessel {
  const p = f.properties;
  const shipType = meta?.shipType ?? null;
  return {
    mmsi: f.mmsi,
    name: clean(meta?.name),
    lat: f.geometry.coordinates[1],
    lon: f.geometry.coordinates[0],
    // Digitraffic marks "not available" with 102.3 kn, 360° and 511°.
    sogKt: p.sog >= 102.3 ? null : p.sog,
    cogDeg: p.cog >= 360 ? null : p.cog,
    headingDeg: p.heading >= 360 ? null : p.heading,
    navStatus: p.navStat === 15 ? null : p.navStat,
    shipType,
    category: categoryOf(shipType),
    flag: flagOf(f.mmsi),
    at: p.timestampExternal,
    source: "digitraffic",
  };
}

const inBox = (v: { lat: number; lon: number }, box: Box): boolean => v.lat >= box.south && v.lat <= box.north && (box.west <= box.east ? v.lon >= box.west && v.lon <= box.east : v.lon >= box.west || v.lon <= box.east);

async function finnishVessels(box: Box, now: number): Promise<Vessel[]> {
  const [locations, registry] = await Promise.all([finnishLocations(), registryOrEmpty()]);
  return locations.map((f) => finnishVessel(f, registry.get(f.mmsi))).filter((v) => now - v.at <= MAX_AGE_MS && inBox(v, box));
}

// ── Norwegian stream ──────────────────────────────────────────────

function norwegianVessel({ position: p, at, info }: TrackedVessel): Vessel {
  return {
    mmsi: p.mmsi,
    name: info.name ?? null,
    lat: p.lat,
    lon: p.lon,
    sogKt: p.sogKt,
    cogDeg: p.cogDeg,
    headingDeg: p.headingDeg,
    navStatus: p.navStatus,
    shipType: info.shipType ?? null,
    category: categoryOf(info.shipType ?? null),
    flag: flagOf(p.mmsi),
    at,
    source: "kystverket",
  };
}

// ── AIS Stream JSON boundary ──────────────────────────────────────

const Mmsi = z.number().int().min(1).max(999_999_999);
const Metadata = z.object({ MMSI: Mmsi, ShipName: z.string().optional(), time_utc: z.string().optional() });
const Identity = { UserID: Mmsi, Valid: z.boolean() };
const Dimension = z.object({ A: z.number().int().nonnegative(), B: z.number().int().nonnegative(), C: z.number().int().nonnegative(), D: z.number().int().nonnegative() });
const Static = z.object({
  ...Identity, Name: z.string(), CallSign: z.string(), ImoNumber: z.number().int().nonnegative(), Type: z.number().int().nonnegative(), Dimension,
  Eta: z.object({ Month: z.number().int(), Day: z.number().int(), Hour: z.number().int(), Minute: z.number().int() }), MaximumStaticDraught: z.number().nonnegative(), Destination: z.string(),
});
const Position = z.object({ ...Identity, Latitude: z.number(), Longitude: z.number(), Sog: z.number().nonnegative(), Cog: z.number().nonnegative(), TrueHeading: z.number().int().nonnegative(), NavigationalStatus: z.number().int().nonnegative().optional() });
const LongRange = Position.omit({ TrueHeading: true }).extend({ NavigationalStatus: z.number().int().nonnegative() });
const Extended = Position.extend({ Name: z.string(), Type: z.number().int().nonnegative(), Dimension });
const Sar = Position.omit({ TrueHeading: true }).extend({ Altitude: z.number().int().nonnegative() });
const ClassBStatic = z.object({ ...Identity, PartNumber: z.boolean(), ReportA: z.object({ Valid: z.boolean(), Name: z.string() }), ReportB: z.object({ Valid: z.boolean(), ShipType: z.number().int().nonnegative(), CallSign: z.string(), Dimension }) });
const Safety = z.object({ ...Identity, Text: z.string() });
const AisStreamEnvelope = z.discriminatedUnion("MessageType", [
  z.object({ MessageType: z.literal("SubscriptionConfirmation"), Message: z.object({ CompressionEnabled: z.boolean() }) }),
  z.object({ MessageType: z.literal("PositionReport"), MetaData: Metadata, Message: z.object({ PositionReport: Position }) }),
  z.object({ MessageType: z.literal("StandardClassBPositionReport"), MetaData: Metadata, Message: z.object({ StandardClassBPositionReport: Position }) }),
  z.object({ MessageType: z.literal("ExtendedClassBPositionReport"), MetaData: Metadata, Message: z.object({ ExtendedClassBPositionReport: Extended }) }),
  z.object({ MessageType: z.literal("LongRangeAisBroadcastMessage"), MetaData: Metadata, Message: z.object({ LongRangeAisBroadcastMessage: LongRange }) }),
  z.object({ MessageType: z.literal("StandardSearchAndRescueAircraftReport"), MetaData: Metadata, Message: z.object({ StandardSearchAndRescueAircraftReport: Sar }) }),
  z.object({ MessageType: z.literal("ShipStaticData"), MetaData: Metadata, Message: z.object({ ShipStaticData: Static }) }),
  z.object({ MessageType: z.literal("StaticDataReport"), MetaData: Metadata, Message: z.object({ StaticDataReport: ClassBStatic }) }),
  z.object({ MessageType: z.literal("SafetyBroadcastMessage"), MetaData: Metadata, Message: z.object({ SafetyBroadcastMessage: Safety }) }),
  z.object({ MessageType: z.literal("AddressedSafetyMessage"), MetaData: Metadata, Message: z.object({ AddressedSafetyMessage: Safety.extend({ DestinationID: Mmsi }) }) }),
]);
const GlobalEnvelope = z.union([z.object({ error: z.string() }), AisStreamEnvelope]);

const dimensions = (d: z.infer<typeof Dimension>): Pick<AisStatic, "toBowM" | "toSternM" | "toPortM" | "toStarboardM"> => ({ toBowM: d.A, toSternM: d.B, toPortM: d.C, toStarboardM: d.D });

function streamTime(value: string | undefined): number {
  if (value === undefined) return Date.now();
  // The stream publishes Go's UTC timestamp format rather than an ISO timestamp.
  const at = Date.parse(value.replace(/ \+0000 UTC$/, "Z").replace(" ", "T"));
  if (!Number.isFinite(at)) throw new HttpError(502, "upstream_shape", "AIS Stream sent an invalid report time");
  return at;
}

/** Validate JSON once before it enters the stream's state. Never expose an upstream error payload. */
export function parseAisStream(data: unknown): GlobalReport | null {
  const e = parseUpstream("AIS Stream", GlobalEnvelope, data);
  if ("error" in e) return { kind: "error" };
  if (e.MessageType === "SubscriptionConfirmation") return { kind: "confirmed", compressed: e.Message.CompressionEnabled };
  const name = clean(e.MetaData.ShipName);
  switch (e.MessageType) {
    case "ShipStaticData": {
      const m = e.Message.ShipStaticData;
      if (!m.Valid) return null;
      const eta = m.Eta;
      const staticName = clean(m.Name);
      const callSign = clean(m.CallSign);
      const destination = clean(m.Destination);
      return { kind: "static", mmsi: m.UserID, info: {
        ...(staticName ? { name: staticName } : {}), ...(callSign ? { callSign } : {}),
        ...(m.ImoNumber > 0 ? { imo: m.ImoNumber } : {}), ...(m.Type > 0 ? { shipType: m.Type } : {}), ...dimensions(m.Dimension),
        ...(m.MaximumStaticDraught > 0 ? { draughtM: m.MaximumStaticDraught } : {}), ...(destination ? { destination } : {}),
        eta: eta.Month > 0 && eta.Month <= 12 && eta.Day > 0 && eta.Day <= 31 && eta.Hour >= 0 && eta.Hour < 24 && eta.Minute >= 0 && eta.Minute < 60 ? [eta.Month, eta.Day, eta.Hour, eta.Minute] : null,
      } };
    }
    case "StaticDataReport": {
      const m = e.Message.StaticDataReport;
      if (!m.Valid) return null;
      const a = !m.PartNumber && m.ReportA.Valid ? clean(m.ReportA.Name) : null;
      const b = m.PartNumber && m.ReportB.Valid ? m.ReportB : null;
      const callSign = clean(b?.CallSign);
      return { kind: "static", mmsi: m.UserID, info: {
        ...(a ? { name: a } : {}), ...(b ? { ...(b.ShipType > 0 ? { shipType: b.ShipType } : {}), ...(callSign ? { callSign } : {}), ...(!String(m.UserID).startsWith("98") ? dimensions(b.Dimension) : {}) } : {}),
      } };
    }
    case "SafetyBroadcastMessage":
    case "AddressedSafetyMessage": {
      const m = e.MessageType === "SafetyBroadcastMessage" ? e.Message.SafetyBroadcastMessage : e.Message.AddressedSafetyMessage;
      const text = clean(m.Text);
      if (!m.Valid || !text) return null;
      return { kind: "safety", mmsi: m.UserID, report: { text, at: streamTime(e.MetaData.time_utc), ...(e.MessageType === "AddressedSafetyMessage" ? { recipientMmsi: e.Message.AddressedSafetyMessage.DestinationID } : {}) } };
    }
    default: {
      const m = e.MessageType === "PositionReport" ? e.Message.PositionReport : e.MessageType === "StandardClassBPositionReport" ? e.Message.StandardClassBPositionReport : e.MessageType === "ExtendedClassBPositionReport" ? e.Message.ExtendedClassBPositionReport : e.MessageType === "LongRangeAisBroadcastMessage" ? e.Message.LongRangeAisBroadcastMessage : e.Message.StandardSearchAndRescueAircraftReport;
      if (!m.Valid || Math.abs(m.Latitude) > 90 || Math.abs(m.Longitude) > 180) return null;
      const sar = e.MessageType === "StandardSearchAndRescueAircraftReport";
      const longRange = e.MessageType === "LongRangeAisBroadcastMessage";
      const extended = e.MessageType === "ExtendedClassBPositionReport" ? e.Message.ExtendedClassBPositionReport : null;
      const extendedName = clean(extended?.Name);
      return { kind: "position", name, at: streamTime(e.MetaData.time_utc), position: {
        kind: "position", mmsi: m.UserID, lat: m.Latitude, lon: m.Longitude,
        sogKt: m.Sog >= (sar ? 1023 : longRange ? 63 : 102.3) ? null : m.Sog,
        cogDeg: m.Cog >= (longRange ? 511 : 360) ? null : m.Cog,
        headingDeg: "TrueHeading" in m && m.TrueHeading < 360 ? m.TrueHeading : null,
        navStatus: "NavigationalStatus" in m && m.NavigationalStatus !== undefined && m.NavigationalStatus < 15 ? m.NavigationalStatus : null,
      }, ...(e.MessageType === "StandardSearchAndRescueAircraftReport" ? { reportKind: "sar-aircraft", altitudeM: e.Message.StandardSearchAndRescueAircraftReport.Altitude < 4095 ? e.Message.StandardSearchAndRescueAircraftReport.Altitude : null } : {}),
      ...(extended ? { info: { ...(extendedName ? { name: extendedName } : {}), ...(extended.Type > 0 ? { shipType: extended.Type } : {}), ...dimensions(extended.Dimension) } } : {}) };
    }
  }
}

let global: GlobalAisStream | null = null;
function globalStream(): GlobalAisStream | null {
  const key = process.env.VANTAGE_AISSTREAM_KEY;
  return key ? (global ??= new GlobalAisStream({ key, parse: parseAisStream })) : null;
}

function globalVessel(v: GlobalTrackedVessel): Vessel {
  return { ...norwegianVessel(v), source: "aisstream", reportKind: v.reportKind, altitudeM: v.altitudeM };
}

// ── Routes ────────────────────────────────────────────────────────

const lon = z.coerce.number().min(-180).max(180);
const lat = z.coerce.number().min(-90).max(90);

export default defineSource({
  probes: [{ name: "Ships · Digitraffic Marine", url: "https://meri.digitraffic.fi/api/ais/v1/vessels/230994000" }],
  routes: {
    "GET /near": async (req) => {
      const box = parseQuery(req, z.object({ west: lon, south: lat, east: lon, north: lat }));
      const now = Date.now();
      const sources: ShipSource[] = [];
      const found: Vessel[] = [];
      const worldwide = { id: "aisstream", name: "AIS Stream network" } as const;
      const stream = globalStream();
      if (stream) {
        stream.want(box);
        const list = stream.within(box).map(globalVessel);
        found.push(...list);
        sources.push({ ...worldwide, state: stream.state === "connected" ? "ok" : stream.state === "unreachable" ? "unreachable" : "connecting", count: list.length, ...(stream.error ? { error: stream.error } : {}), ...(stream.compressed !== null ? { compressed: stream.compressed } : {}) });
      } else sources.push({ ...worldwide, state: "unconfigured", count: 0, error: "Set VANTAGE_AISSTREAM_KEY on the server and restart it to receive AIS Stream reports. Create a key at aisstream.io." });

      const finland = { id: "digitraffic", name: "Digitraffic Marine (Finland)" } as const;
      if (intersects(box, FINLAND_BOX)) {
        try {
          const list = await finnishVessels(box, now);
          found.push(...list);
          sources.push({ ...finland, state: "ok", count: list.length });
        } catch (err) {
          sources.push({ ...finland, state: "unreachable", count: 0, error: err instanceof Error ? err.message : String(err) });
        }
      } else sources.push({ ...finland, state: "idle", count: 0 });

      const norwegian = { id: "kystverket", name: "Norwegian Coastal Administration" } as const;
      if (intersects(box, NORWAY_BOX)) {
        const stream = norwegianStream();
        stream.want();
        const list = stream.within(box).map(norwegianVessel).filter((v) => now - v.at <= MAX_AGE_MS);
        found.push(...list);
        const state = stream.state === "connected" ? "ok" : stream.state === "unreachable" ? "unreachable" : "connecting";
        sources.push({ ...norwegian, state, count: list.length, ...(state === "unreachable" && stream.error ? { error: stream.error } : {}) });
      } else sources.push({ ...norwegian, state: "idle", count: 0 });

      // A vessel heard by several sources keeps its newer report.
      const newest = new Map<number, Vessel>();
      for (const v of found) {
        const held = newest.get(v.mmsi);
        if (!held || v.at > held.at) newest.set(v.mmsi, v);
      }
      return json({ fetchedAt: now, vessels: [...newest.values()].slice(0, MAX_VESSELS), sources } satisfies ShipsNear, { maxAge: 10 });
    },

    "GET /vessel": async (req) => {
      const { mmsi } = parseQuery(req, z.object({ mmsi: z.coerce.number().int().min(1).max(999_999_999) }));
      const now = Date.now();
      const worldwide = global?.find(mmsi) ?? null;
      const norwegian = norway?.find(mmsi) ?? null;
      const tracked = worldwide && (!norwegian || worldwide.at >= norwegian.at) ? worldwide : norwegian;
      if (worldwide && global) {
        const { lat, lon } = worldwide.position;
        const west = lon - 0.25;
        const east = lon + 0.25;
        global.want({ west: west < -180 ? west + 360 : west, south: Math.max(-90, lat - 0.25), east: east > 180 ? east - 360 : east, north: Math.min(90, lat + 0.25) });
      }
      const registry = await registryOrEmpty();
      const fi = registry.get(mmsi);
      const location = tracked ? null : (await finnishLocations().catch(() => [])).find((f) => f.mmsi === mmsi);
      const base = tracked ? tracked === worldwide && worldwide ? globalVessel(worldwide) : norwegianVessel(tracked) : location ? finnishVessel(location, fi) : null;
      if (!base || now - base.at > MAX_AGE_MS) throw new HttpError(404, "unknown_vessel", "This vessel has not reported for 20 minutes, so it is no longer on the map.");

      const statics = tracked?.info;
      const length = (statics?.toBowM ?? fi?.referencePointA ?? 0) + (statics?.toSternM ?? fi?.referencePointB ?? 0);
      const beam = (statics?.toPortM ?? fi?.referencePointC ?? 0) + (statics?.toStarboardM ?? fi?.referencePointD ?? 0);
      const details: ShipDetails = {
        ...base,
        name: base.name ?? clean(fi?.name),
        shipType: base.shipType ?? fi?.shipType ?? null,
        category: categoryOf(base.shipType ?? fi?.shipType ?? null),
        ...(worldwide ? { safetyReports: worldwide.safetyReports } : {}),
        callSign: clean(statics?.callSign ?? fi?.callSign),
        imo: statics?.imo || fi?.imo || null,
        destination: clean(statics?.destination ?? fi?.destination),
        etaMs: etaMs(statics?.eta ?? unpackEta(fi?.eta), now),
        // Digitraffic gives the draught in tenths of a metre, like the AIS message.
        draughtM: statics?.draughtM ?? (fi?.draught ? fi.draught / 10 : null),
        lengthM: length > 0 ? length : null,
        beamM: beam > 0 ? beam : null,
      };
      return json(details, { maxAge: 10 });
    },
  },
});

