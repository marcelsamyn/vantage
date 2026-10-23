import { gunzipSync } from "node:zlib";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import {
  defineSource,
  describe,
  fetchJson,
  fetchUpstream,
  HttpError,
  json,
  memo,
  parseQuery,
  parseUpstream,
  z,
} from "../../server/kit";
import { tomtomCached, tomtomFetch, tomtomJson } from "./tomtom.server";
import { zoned } from "../pulse/time.server";
import {
  inView,
  overlaps,
  TRAFFIC_SOURCES,
  TRAFFIC_FLOW_REFRESH_MS,
  type TrafficBox,
  type TrafficEvent,
  type TrafficGeometry,
  type TrafficResult,
  type TrafficSourceId,
} from "./types";

const coordinate = z.tuple([
  z.number().min(-180).max(180),
  z.number().min(-90).max(90),
]);
const geometry = z.discriminatedUnion("type", [
  z.object({ type: z.literal("Point"), coordinates: coordinate }),
  z.object({
    type: z.literal("LineString"),
    coordinates: z.array(coordinate).min(2),
  }),
  z.object({
    type: z.literal("MultiLineString"),
    coordinates: z.array(z.array(coordinate).min(2)).min(1),
  }),
  z.object({
    type: z.literal("Polygon"),
    coordinates: z.array(z.array(coordinate).min(4)).min(1),
  }),
  z.object({
    type: z.literal("MultiPolygon"),
    coordinates: z.array(z.array(z.array(coordinate).min(4)).min(1)).min(1),
  }),
]);
const text = z.string().nullish();
const tfl = z.array(
  z.object({
    id: z.string(),
    geography: geometry.nullish(),
    point: text,
    category: text,
    subCategory: text,
    comments: text,
    currentUpdate: text,
    severity: text,
    location: text,
    status: text,
    startDateTime: text,
    endDateTime: text,
    lastModifiedTime: text,
    hasClosures: z.boolean().optional(),
  }),
);
const digitraffic = z.object({
  features: z.array(
    z.object({
      geometry: geometry.nullable(),
      properties: z.object({
        situationId: z.string(),
        situationType: z.string(),
        versionTime: text,
        announcements: z.array(
          z.object({
            language: z.string(),
            title: z.string(),
            location: z.object({ description: text }).nullish(),
            timeAndDuration: z
              .object({ startTime: text, endTime: text })
              .nullish(),
            features: z.array(z.object({ name: z.string() })).optional(),
            additionalInformation: text,
            sender: text,
          }),
        ),
      }),
    }),
  ),
});
const brussels = z.object({
  numberMatched: z.number().optional(),
  features: z.array(
    z.object({
      id: z.union([z.string(), z.number()]),
      geometry,
      properties: z.object({
        type_fr: text,
        type_nl: text,
        location_fr: text,
        location_nl: text,
        direction_fr: text,
        direction_nl: text,
        consequences_fr: text,
        consequences_nl: text,
        importance: text,
        start_time: text,
        end_time: text,
        last_update: text,
        last_layer_update: text,
        is_active: z.boolean(),
      }),
    }),
  ),
});
const austin = z.array(
  z.object({
    traffic_report_id: z.string(),
    traffic_report_status: z.string(),
    published_date: text,
    date_time: text,
    issue_reported: text,
    address: text,
    agency: text,
    location: z
      .object({ type: z.literal("Point"), coordinates: coordinate })
      .nullish(),
    latitude: text,
    longitude: text,
  }),
);
const tomtom = z.object({
  incidents: z.array(
    z.object({
      geometry,
      properties: z.object({
        id: z.string(),
        iconCategory: z.string(),
        magnitudeOfDelay: text,
        events: z.array(
          z.object({
            description: z.string(),
            code: z.number(),
            iconCategory: z.string(),
          }),
        ),
        startTime: text,
        endTime: text,
        from: text,
        to: text,
        lengthInMeters: z.number().nonnegative(),
        delayInSeconds: z.number().nullish(),
        roadNumbers: z.array(z.string()),
        timeValidity: z.string(),
        probabilityOfOccurrence: text,
        numberOfReports: z.number().nullish(),
        lastReportTime: text,
      }),
    }),
  ),
});

const scalar = z.union([z.string(), z.number(), z.boolean()]);
interface XmlLocation {
  pointCoordinates?: { latitude: number; longitude: number };
  gmlLineString?: { posList: string };
  locationContainedInItinerary?: XmlLocation[];
  location?: XmlLocation;
  tpegPointLocation?: XmlLocation;
  point?: XmlLocation;
  pointByCoordinates?: XmlLocation;
  tpegLinearLocation?: XmlLocation;
  from?: XmlLocation;
  to?: XmlLocation;
  linearWithinLinearElement?: { linearElement?: { roadNumber?: string } };
}
const location: z.ZodType<XmlLocation> = z.lazy(() =>
  z.object({
    pointCoordinates: z
      .object({
        latitude: z.number().min(-90).max(90),
        longitude: z.number().min(-180).max(180),
      })
      .optional(),
    gmlLineString: z.object({ posList: z.string() }).optional(),
    locationContainedInItinerary: z.array(location).optional(),
    location: location.optional(),
    tpegPointLocation: location.optional(),
    point: location.optional(),
    pointByCoordinates: location.optional(),
    tpegLinearLocation: location.optional(),
    from: location.optional(),
    to: location.optional(),
    linearWithinLinearElement: z
      .object({
        linearElement: z
          .object({ roadNumber: z.string().optional() })
          .optional(),
      })
      .optional(),
  }),
);
const multilingual = z.object({
  values: z.object({
    value: z.array(
      z.union([
        scalar,
        z.object({ "#text": scalar, "@_lang": z.string().optional() }),
      ]),
    ),
  }),
});
const datexRecord = z.object({
  "@_id": z.string(),
  "@_type": z.string(),
  situationRecordVersionTime: text,
  situationRecordCreationTime: text,
  validity: z.object({
    validityStatus: z.string(),
    validityTimeSpecification: z
      .object({
        overallStartTime: text,
        overallEndTime: text,
        validPeriod: z
          .array(z.object({ startOfPeriod: text, endOfPeriod: text }))
          .optional(),
      })
      .optional(),
  }),
  locationReference: location.optional(),
  groupOfLocations: location.optional(),
  generalPublicComment: z
    .array(z.object({ comment: multilingual, commentType: text }))
    .optional(),
  roadOrCarriagewayOrLaneManagementType: text,
  constructionWorkType: text,
  maintenanceWorkType: text,
  accidentType: text,
  abnormalTrafficType: text,
  weatherRelatedRoadConditionType: text,
  obstructionType: text,
  operatorActionStatus: text,
  cause: z.object({ causeType: text }).optional(),
});
const publication = z.object({
  publicationTime: text,
  situation: z
    .array(
      z.object({
        "@_id": z.string(),
        overallSeverity: text,
        situationRecord: z.array(datexRecord),
      }),
    )
    .default([]),
});
const ndw = z.object({ messageContainer: z.object({ payload: publication }) });
const france = z.object({
  Envelope: z.object({
    Body: z.object({
      d2LogicalModel: z.object({ payloadPublication: publication }),
    }),
  }),
});
const parser = new XMLParser({
  ignoreAttributes: false,
  removeNSPrefix: true,
  parseAttributeValue: false,
  isArray: (n) =>
    [
      "situation",
      "situationRecord",
      "value",
      "generalPublicComment",
      "locationContainedInItinerary",
      "validPeriod",
    ].includes(n),
});

function instant(
  value: string | null | undefined,
  zone?: string,
): number | null {
  if (!value) return null;
  const ms =
    zone && !/(?:Z|[+-]\d\d:\d\d)$/.test(value)
      ? zoned(value, zone)
      : Date.parse(value);
  return ms !== null && Number.isFinite(ms) ? ms : null;
}
function event(
  source: TrafficSourceId,
  id: string,
  shape: TrafficGeometry,
  values: Partial<Omit<TrafficEvent, "id" | "source" | "geometry">>,
  now: number,
): TrafficEvent | null {
  const info = TRAFFIC_SOURCES.find((s) => s.id === source);
  const out: TrafficEvent = {
    id,
    source,
    geometry: shape,
    title: "Road disruption",
    description: "",
    location: "",
    category: "",
    severity: "",
    startsAt: null,
    endsAt: null,
    updatedAt: null,
    rows: [],
    url: info?.url ?? "",
    status: "active",
    ...values,
  };
  if (out.endsAt !== null && out.endsAt <= now) return null;
  if (out.startsAt !== null && out.startsAt > now) out.status = "planned";
  return out;
}
function compact(values: (TrafficEvent | null)[]): TrafficEvent[] {
  return values.filter((v) => v !== null);
}
export function londonEvents(data: unknown, now: number): TrafficEvent[] {
  return adaptLondon(parseUpstream("TfL", tfl, data), now);
}
function adaptLondon(data: z.infer<typeof tfl>, now: number): TrafficEvent[] {
  return compact(
    data.map((r) => {
      if (/completed|closed|removed|cancelled/i.test(r.status ?? ""))
        return null;
      let shape = r.geography;
      if (!shape && r.point) {
        let raw: unknown;
        try { raw = JSON.parse(r.point); }
        catch { throw new HttpError(502, "upstream_shape", "TfL supplied an invalid point coordinate"); }
        shape = { type: "Point", coordinates: parseUpstream("TfL point", coordinate, raw) };
      }
      if (!shape) return null;
      return event("london", r.id, shape, {
        title: r.subCategory ?? r.category ?? "Road disruption",
        description: [r.comments, r.currentUpdate].filter(Boolean).join("\n"),
        location: r.location ?? "", category: r.category ?? "", severity: r.severity ?? "",
        status: /planned|scheduled/i.test(r.status ?? "") ? "planned" : "active",
        startsAt: instant(r.startDateTime), endsAt: instant(r.endDateTime), updatedAt: instant(r.lastModifiedTime),
        rows: [["TfL status", r.status ?? ""], ["Closures", r.hasClosures === undefined ? "Not published" : r.hasClosures ? "Yes" : "No"]],
      }, now);
    }),
  );
}
export function finlandEvents(data: unknown, now: number): TrafficEvent[] {
  return adaptFinland(parseUpstream("Digitraffic", digitraffic, data), now);
}
function adaptFinland(
  data: z.infer<typeof digitraffic>,
  now: number,
): TrafficEvent[] {
  return compact(
    data.features.map((f) => {
      const p = f.properties;
      const a =
        p.announcements.find((a) => a.language === "en") ??
        p.announcements.find((a) => a.language === "fi") ??
        p.announcements[0];
      return a && f.geometry
        ? event(
            "finland",
            p.situationId,
            f.geometry,
            {
              title: a.title,
              description: [
                ...(a.features ?? []).map((f) => f.name),
                a.additionalInformation,
              ]
                .filter(Boolean)
                .join("\n"),
              location: a.location?.description ?? "",
              category: p.situationType,
              startsAt: instant(a.timeAndDuration?.startTime),
              endsAt: instant(a.timeAndDuration?.endTime),
              updatedAt: instant(p.versionTime),
              rows: [
                ["Sender", a.sender ?? ""],
                ["Language", a.language],
              ],
            },
            now,
          )
        : null;
    }),
  );
}
export function brusselsEvents(data: unknown, now: number): TrafficEvent[] {
  return adaptBrussels(parseUpstream("Brussels Mobility", brussels, data), now);
}
function adaptBrussels(
  data: z.infer<typeof brussels>,
  now: number,
): TrafficEvent[] {
  return compact(
    data.features.map((f) => {
      const p = f.properties;
      if (!p.is_active) return null;
      return event(
        "brussels",
        String(f.id),
        f.geometry,
        {
          title: p.type_fr ?? p.type_nl ?? "Road disruption",
          description: p.consequences_fr ?? p.consequences_nl ?? "",
          location: p.location_fr ?? p.location_nl ?? "",
          severity: p.importance ?? "",
          category: p.type_fr ?? "",
          startsAt: instant(p.start_time, "Europe/Brussels"),
          endsAt: instant(p.end_time, "Europe/Brussels"),
          updatedAt: instant(p.last_update, "Europe/Brussels"),
          rows: [
            ["Direction", p.direction_fr ?? ""],
            ["Type (NL)", p.type_nl ?? ""],
            ["Location (NL)", p.location_nl ?? ""],
            ["Direction (NL)", p.direction_nl ?? ""],
            ["Consequences (NL)", p.consequences_nl ?? ""],
            ["Layer updated", p.last_layer_update ?? ""],
          ],
          url: `https://api.mobility.brussels/datasets/v1/traffic/collections/traffic_events/items/${f.id}/`,
        },
        now,
      );
    }),
  );
}
export function austinEvents(data: unknown, now: number): TrafficEvent[] {
  return adaptAustin(parseUpstream("Austin", austin, data), now);
}
function adaptAustin(
  data: z.infer<typeof austin>,
  now: number,
): TrafficEvent[] {
  return compact(
    data.map((r) => {
      if (r.traffic_report_status !== "ACTIVE") return null;
      const coords =
        r.latitude && r.longitude
          ? coordinate.safeParse([Number(r.longitude), Number(r.latitude)])
          : null;
      const shape =
        r.location ??
        (coords?.success
          ? { type: "Point" as const, coordinates: coords.data }
          : null);
      return shape
        ? event(
            "austin",
            r.traffic_report_id,
            shape,
            {
              title: r.issue_reported ?? "Traffic report",
              location: r.address ?? "",
              updatedAt: instant(r.published_date, "America/Chicago"),
              startsAt: instant(r.date_time, "America/Chicago"),
              rows: [
                ["Agency", r.agency ?? ""],
                ["Report status", r.traffic_report_status],
              ],
            },
            now,
          )
        : null;
    }),
  );
}
export function tomtomEvents(
  data: z.infer<typeof tomtom>,
  now: number,
): TrafficEvent[] {
  return compact(
    data.incidents.map((r) => {
      const p = r.properties;
      return event(
        "tomtom",
        p.id,
        r.geometry,
        {
          title: p.events[0]?.description ?? p.iconCategory,
          description: p.events.map((e) => e.description).join("\n"),
          category: p.iconCategory,
          severity: p.magnitudeOfDelay ?? "",
          lengthM: p.lengthInMeters,
          location: [p.from, p.to].filter(Boolean).join(" → "),
          status: p.timeValidity === "future" ? "planned" : "active",
          startsAt: instant(p.startTime),
          endsAt: instant(p.endTime),
          updatedAt: instant(p.lastReportTime),
          rows: [
            ["Roads", p.roadNumbers.join(", ")],
            [
              "Delay",
              p.delayInSeconds === null || p.delayInSeconds === undefined
                ? "Unknown"
                : `${p.delayInSeconds} s`,
            ],
            ["Probability", p.probabilityOfOccurrence ?? ""],
            ["Reports", p.numberOfReports?.toString() ?? ""],
            ["Time validity", p.timeValidity],
          ],
        },
        now,
      );
    }),
  );
}
function locations(l: XmlLocation): TrafficGeometry[] {
  if (l.gmlLineString) {
    const values = l.gmlLineString.posList.trim().split(/\s+/).map(Number);
    const coords: [number, number][] = [];
    for (let i = 0; i + 1 < values.length; i += 2) {
      const lat = values[i];
      const lon = values[i + 1];
      if (
        lat !== undefined &&
        lon !== undefined &&
        Number.isFinite(lat) &&
        Number.isFinite(lon) &&
        Math.abs(lat) <= 90 &&
        Math.abs(lon) <= 180
      )
        coords.push([lon, lat]);
    }
    if (coords.length >= 2 && coords.length * 2 === values.length)
      return [{ type: "LineString", coordinates: coords }];
  }
  if (l.pointCoordinates)
    return [
      {
        type: "Point",
        coordinates: [
          l.pointCoordinates.longitude,
          l.pointCoordinates.latitude,
        ],
      },
    ];
  const children = [
    ...(l.locationContainedInItinerary ?? []),
    l.location,
    l.tpegPointLocation,
    l.point,
    l.pointByCoordinates,
  ].filter((v) => v !== undefined);
  if (children.length) return children.flatMap(locations);
  // DATEX endpoints do not define the road's path. Keep a supplied endpoint as a point, never invent a straight road.
  if (l.tpegLinearLocation?.from) return locations(l.tpegLinearLocation.from);
  return [];
}
export function datexEvents(
  xml: string,
  source: "netherlands" | "france",
  now: number,
): TrafficEvent[] {
  if (XMLValidator.validate(xml) !== true)
    throw new HttpError(502, "upstream_shape", `${source} sent invalid XML`);
  const raw: unknown = parser.parse(xml);
  const p =
    source === "netherlands"
      ? parseUpstream("NDW", ndw, raw).messageContainer.payload
      : parseUpstream("Bison Futé", france, raw).Envelope.Body.d2LogicalModel
          .payloadPublication;
  return compact(
    p.situation.flatMap((s) =>
      s.situationRecord.map((r) => {
        if (
          r.validity.validityStatus === "suspended" ||
          r.operatorActionStatus === "cancelled" ||
          r.operatorActionStatus === "completed"
        )
          return null;
        const spec = r.validity.validityTimeSpecification;
        const periods = (spec?.validPeriod ?? [])
          .map((v) => ({
            start: instant(v.startOfPeriod),
            end: instant(v.endOfPeriod),
          }))
          .filter((v) => v.end === null || v.end > now);
        if (spec?.validPeriod?.length && !periods.length) return null;
        const period =
          periods.find((v) => v.start === null || v.start <= now) ?? periods[0];
        const l = r.locationReference ?? r.groupOfLocations;
        if (!l) return null;
        const shapes = locations(l);
        const lines = shapes.filter((g) => g.type === "LineString");
        const shape: TrafficGeometry | undefined =
          lines.length > 1
            ? {
                type: "MultiLineString",
                coordinates: lines.map((g) => g.coordinates),
              }
            : (lines[0] ?? shapes[0]);
        if (!shape) return null;
        const comments = (r.generalPublicComment ?? [])
          .map((c) =>
            c.comment.values.value
              .map((v) =>
                typeof v === "object" ? String(v["#text"]) : String(v),
              )
              .join(" · "),
          )
          .join("\n");
        const category =
          r.roadOrCarriagewayOrLaneManagementType ??
          r.constructionWorkType ??
          r.maintenanceWorkType ??
          r.accidentType ??
          r.abnormalTrafficType ??
          r.weatherRelatedRoadConditionType ??
          r.obstructionType ??
          r["@_type"].split(":").at(-1) ??
          "Road disruption";
        return event(
          source,
          r["@_id"],
          shape,
          {
            title: category.replace(/([a-z])([A-Z])/g, "$1 $2"),
            category,
            description: comments,
            severity: s.overallSeverity ?? "",
            location:
              l.linearWithinLinearElement?.linearElement?.roadNumber ?? "",
            startsAt: period?.start ?? instant(spec?.overallStartTime),
            endsAt: period?.end ?? instant(spec?.overallEndTime),
            updatedAt: instant(
              r.situationRecordVersionTime ?? p.publicationTime,
            ),
            rows: [
              ["Situation", s["@_id"]],
              ["Validity", r.validity.validityStatus],
              ["Operator status", r.operatorActionStatus ?? ""],
              ["Cause", r.cause?.causeType ?? ""],
            ],
          },
          now,
        );
      }),
    ),
  );
}

export function readTrafficKey(): string | null {
  return process.env.VANTAGE_TOMTOM_KEY?.trim() || null;
}
function requireKey(): string {
  const key = readTrafficKey();
  if (!key)
    throw new HttpError(
      503,
      "needs_key",
      "TomTom traffic needs VANTAGE_TOMTOM_KEY in the server's .env. Create a Traffic API key at developer.tomtom.com, then restart VANTAGE.",
    );
  return key;
}
const sourceQuery = z
  .object({
    source: z.enum([
      "tomtom",
      "london",
      "finland",
      "netherlands",
      "brussels",
      "france",
      "austin",
    ]),
    west: z.coerce.number().min(-180).max(180),
    south: z.coerce.number().min(-90).max(90),
    east: z.coerce.number().min(-180).max(180),
    north: z.coerce.number().min(-90).max(90),
  })
  .refine(
    (b) => b.west < b.east && b.south < b.north,
    "Use a bounding box with west < east and south < north.",
  );
export function tomtomBoxAllowed(b: TrafficBox): boolean {
  return (
    (b.east - b.west) *
      111.32 *
      (b.north - b.south) *
      111.32 *
      Math.max(
        Math.abs(Math.cos((b.south * Math.PI) / 180)),
        Math.abs(Math.cos((b.north * Math.PI) / 180)),
        b.south <= 0 && b.north >= 0 ? 1 : 0,
      ) <=
    10_000
  );
}
async function xmlFrom(
  source: string,
  url: string,
  gzip = false,
): Promise<string> {
  const response = await fetchUpstream(source, url, { timeoutMs: 30_000 });
  const bytes = new Uint8Array(await response.arrayBuffer());
  return gzip && bytes[0] === 0x1f && bytes[1] === 0x8b
    ? gunzipSync(bytes).toString()
    : new TextDecoder().decode(bytes);
}
/** Incidents are fetched per web-map tile at this zoom (about 50 km wide in Europe), so panning reuses the cells it has already paid for. */
const INCIDENT_CELL_ZOOM = 9;
function cellsFor(box: TrafficBox): { x: number; y: number }[] {
  const n = 2 ** INCIDENT_CELL_ZOOM;
  const x = (lon: number): number => Math.min(n - 1, Math.floor(((lon + 180) / 360) * n));
  const y = (lat: number): number => {
    const r = (Math.max(-85.0511, Math.min(85.0511, lat)) * Math.PI) / 180;
    return Math.min(n - 1, Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n));
  };
  const cells: { x: number; y: number }[] = [];
  for (let cx = x(box.west); cx <= x(box.east); cx++)
    for (let cy = y(box.north); cy <= y(box.south); cy++) cells.push({ x: cx, y: cy });
  return cells;
}
function cellBox(cell: { x: number; y: number }): TrafficBox {
  const n = 2 ** INCIDENT_CELL_ZOOM;
  const lat = (ty: number): number => (Math.atan(Math.sinh(Math.PI * (1 - (2 * ty) / n))) * 180) / Math.PI;
  return { west: (cell.x / n) * 360 - 180, east: ((cell.x + 1) / n) * 360 - 180, north: lat(cell.y), south: lat(cell.y + 1) };
}
async function tomtomIncidents(box: TrafficBox, key: string, ttl: number, signal?: AbortSignal): Promise<TrafficResult> {
  const cells = await Promise.all(
    cellsFor(box).map((cell) => {
      const b = cellBox(cell);
      return tomtomCached(`traffic:tomtom:${INCIDENT_CELL_ZOOM}/${cell.x}/${cell.y}`, "call", ttl, async () => {
        const url = new URL("https://api.tomtom.com/maps/orbis/traffic/incidents/details");
        url.searchParams.set("apiVersion", "2");
        url.searchParams.set("bbox", [b.west, b.south, b.east, b.north].join(","));
        url.searchParams.set("timeValidity", "present");
        const data = await tomtomJson("TomTom", url, tomtom, key, {
          headers: { "TomTom-Api-Key": key, "TomTom-Api-Version": "2", Attributes: "incidents(type,geometry,properties)" },
        });
        return tomtomEvents(data, Date.now());
      }, signal);
    }),
  );
  const now = Date.now();
  const events = new Map(cells.flatMap((c) => c.value).map((e) => [e.id, e] as const));
  return {
    events: [...events.values()].filter((e) => (e.endsAt === null || e.endsAt > now) && inView(e, box)),
    fetchedAt: Math.min(...cells.map((c) => c.at)),
    capped: false,
    failed: [],
  };
}
export async function loadTraffic(
  source: TrafficSourceId,
  box: TrafficBox,
  signal?: AbortSignal,
): Promise<TrafficResult> {
  const info = TRAFFIC_SOURCES.find((s) => s.id === source);
  if (!info) throw new HttpError(400, "source", "Unknown traffic source");
  if (info.area && !overlaps(info.area, box))
    return { events: [], fetchedAt: Date.now(), capped: false, failed: [] };
  if (source === "tomtom") {
    const key = requireKey();
    if (!tomtomBoxAllowed(box))
      throw new HttpError(
        400,
        "zoom_in",
        "Zoom in: TomTom incident requests cover at most 10,000 km².",
      );
    return tomtomIncidents(box, key, info.refreshMs, signal);
  }
  const result = await memo(
    `traffic:${source}`,
    info.refreshMs,
    async (): Promise<TrafficResult> => {
      const now = Date.now();
      let events: TrafficEvent[];
      let capped = false;
      const failed: string[] = [];
      switch (source) {
        case "london":
          events = adaptLondon(
            await fetchJson(
              "TfL",
              "https://api.tfl.gov.uk/Road/all/Disruption",
              tfl,
            ),
            now,
          );
          break;
        case "finland": {
          const responses = await Promise.allSettled(
            ["traffic-announcements", "roadworks"].map(async (path) =>
              adaptFinland(
                await fetchJson(
                  "Digitraffic",
                  `https://tie.digitraffic.fi/api/traffic-message/v2/${path}`,
                  digitraffic,
                  {
                    headers: {
                      "accept-encoding": "gzip",
                      "Digitraffic-User": "Vantage/1.0",
                    },
                    timeoutMs: 30_000,
                  },
                ),
                now,
              ),
            ),
          );
          const good = responses.filter((r) => r.status === "fulfilled");
          if (!good.length) {
            const failure = responses.find((r) => r.status === "rejected");
            if (failure?.status === "rejected") throw failure.reason;
          }
          events = good.flatMap((r) => r.value);
          responses.forEach((result, i) => {
            if (result.status === "rejected")
              failed.push(
                `Digitraffic ${i === 0 ? "traffic announcements" : "roadworks"}: ${describe(result.reason)}`,
              );
          });
          break;
        }
        case "netherlands":
          events = datexEvents(
            await xmlFrom(
              "NDW",
              "https://opendata.ndw.nu/actueel_beeld.xml.gz",
              true,
            ),
            source,
            now,
          );
          break;
        case "france":
          events = datexEvents(
            await xmlFrom(
              "Bison Futé",
              "https://tipi.bison-fute.gouv.fr/bison-fute-ouvert/publicationsDIR/Evenementiel-DIR/grt/RRN/content.xml",
            ),
            source,
            now,
          );
          break;
        case "brussels": {
          const parsed = await fetchJson(
            "Brussels Mobility",
            "https://api.mobility.brussels/datasets/v1/traffic/collections/traffic_events/items/?f=json&crs=4326&limit=1000",
            brussels,
          );
          capped =
            (parsed.numberMatched ?? parsed.features.length) >
            parsed.features.length;
          events = adaptBrussels(parsed, now);
          break;
        }
        case "austin": {
          const url = new URL(
            "https://data.austintexas.gov/resource/dx9v-zd7x.json",
          );
          url.searchParams.set("$where", "traffic_report_status='ACTIVE'");
          url.searchParams.set("$order", "published_date DESC");
          url.searchParams.set("$limit", "1000");
          events = adaptAustin(await fetchJson("Austin", url, austin), now);
          capped = events.length >= 1000;
          break;
        }
      }
      return { events, fetchedAt: now, capped, failed };
    },
  );
  return {
    ...result,
    events: result.events.filter(
      (e) => (e.endsAt === null || e.endsAt > Date.now()) && inView(e, box),
    ),
  };
}
export const tileQuery = z
  .object({
    z: z.coerce.number().int().min(0).max(22),
    x: z.coerce.number().int().min(0),
    y: z.coerce.number().int().min(0),
  })
  .refine(
    (t) => t.x < 2 ** t.z && t.y < 2 ** t.z,
    "Tile coordinates must fit the zoom level.",
  );
const VECTOR_TILE = "application/vnd.mapbox-vector-tile";
/** Every tag `flow-style.ts` reads. */
const FLOW_TAGS = ["road_category", "relative_speed", "absolute_speed", "road_closure", "left_hand_traffic"];
export async function flowTile(
  tile: z.infer<typeof tileQuery>,
  signal?: AbortSignal,
): Promise<Response> {
  const key = requireKey();
  const { value, at } = await tomtomCached(
    `traffic:flow:${tile.z}/${tile.x}/${tile.y}`,
    "tile",
    TRAFFIC_FLOW_REFRESH_MS,
    async () => {
      const url = new URL(
        `https://api.tomtom.com/maps/orbis/traffic/flow/vector/tile/${tile.z}/${tile.x}/${tile.y}`,
      );
      url.searchParams.set("apiVersion", "2");
      // left_hand_traffic and absolute_speed are explicit tags: TomTom sends them only when named.
      url.searchParams.set("attributes", `tags(${FLOW_TAGS.join(",")})`);
      const res = await tomtomFetch("tile", "TomTom flow", url, key, {
        headers: { "TomTom-Api-Key": key, accept: VECTOR_TILE },
      });
      const data = await res.arrayBuffer();
      if (!res.headers.get("content-type")?.startsWith(VECTOR_TILE))
        throw new HttpError(
          502,
          "upstream_shape",
          "TomTom flow did not return a vector tile",
        );
      return data;
    },
    signal,
  );
  // MapLibre reloads a tile when its max-age ends and keeps showing it meanwhile. A stale tile is asked for again in
  // a minute, by when its refresh has usually arrived.
  const left = at + TRAFFIC_FLOW_REFRESH_MS - Date.now();
  return new Response(value, {
    headers: {
      "content-type": VECTOR_TILE,
      "cache-control": `private, max-age=${left > 0 ? Math.ceil(left / 1000) : 60}`,
    },
  });
}
export default defineSource({
  routes: {
    "GET /events": async (req) => {
      const q = parseQuery(req, sourceQuery);
      return json(await loadTraffic(q.source, q, req.signal));
    },
    "GET /config": () => json({ tomtom: readTrafficKey() !== null }),
    "GET /flow": async (req) => flowTile(parseQuery(req, tileQuery), req.signal),
  },
});
