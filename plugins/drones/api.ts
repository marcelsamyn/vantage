import { defineSource, fetchJson, HttpError, json, memo, z } from "../../server/kit";
import type { Drone, DroneSnapshot } from "./types";

const Age = z.number().nonnegative();
const Latitude = z.number().min(-90).max(90);
const Longitude = z.number().min(-180).max(180);
const Operator = z.object({
  lat: Latitude.optional(), lon: Longitude.optional(),
  location_type: z.enum(["takeoff", "live_gnss", "fixed"]).optional(),
  id: z.string().optional(), alt_takeoff_ft: z.number().optional(), seen: Age.optional(),
}).refine((v) => (v.lat === undefined) === (v.lon === undefined), "Operator coordinates must be a pair");
const Detection = z.object({
  id: z.string().min(1),
  id_type: z.enum(["serial", "caa_reg", "utm_uuid", "session", "unknown"]),
  ua_type: z.string().optional(), lat: Latitude.optional(), lon: Longitude.optional(),
  alt_geom_ft: z.number().optional(), agl_ft: z.number().optional(), gs: z.number().nonnegative().optional(),
  track: z.number().min(0).max(360).optional(), geom_rate: z.number().optional(), rssi: z.number().optional(),
  message_count: z.number().int().nonnegative().optional(), seen: Age, seen_pos: Age.optional(),
  rid_source: z.string().optional(), rid_sources: z.array(z.string()).optional(),
  self_id: z.string().optional(), self_id_seen: Age.optional(), operator: Operator.optional(),
}).refine((v) => (v.lat === undefined) === (v.lon === undefined), "Drone coordinates must be a pair");
const Feed = z.object({ schema_version: z.literal(1), now: z.number().positive(), messages: z.number().int().nonnegative(), drones: z.array(Detection) });

export function receiverUrl(value: string | undefined): URL | null {
  if (value === undefined || value === "") return null;
  let url: URL;
  try { url = new URL(value); } catch {
    throw new HttpError(500, "drone_receiver_config", "VANTAGE_DRONE_RECEIVER_URL must be the full HTTP or HTTPS feed URL on your receiver.");
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash || url.search) {
    throw new HttpError(500, "drone_receiver_config", "Use an HTTP or HTTPS receiver feed URL without credentials, a query, or a fragment.");
  }
  return url;
}

function detection(v: z.infer<typeof Detection>, referenceAt: number): Drone {
  const at = (age: number | undefined): number | null => age === undefined ? null : referenceAt - age * 1000;
  return {
    id: v.id, idType: v.id_type, aircraftType: v.ua_type ?? null,
    position: v.lat === undefined || v.lon === undefined ? null : { lat: v.lat, lon: v.lon },
    reportedAt: referenceAt - v.seen * 1000, positionAt: at(v.seen_pos),
    altitudeM: v.alt_geom_ft === undefined ? null : v.alt_geom_ft * 0.3048,
    heightM: v.agl_ft === undefined ? null : v.agl_ft * 0.3048,
    speedKt: v.gs ?? null, trackDeg: v.track ?? null,
    verticalSpeedMps: v.geom_rate === undefined ? null : v.geom_rate * 0.3048 / 60,
    rssiDbm: v.rssi ?? null, messageCount: v.message_count ?? null,
    transport: v.rid_source ?? null, transports: v.rid_sources ?? (v.rid_source ? [v.rid_source] : []),
    description: v.self_id ?? null, descriptionAt: at(v.self_id_seen),
    operator: v.operator ? {
      position: v.operator.lat === undefined || v.operator.lon === undefined ? null : { lat: v.operator.lat, lon: v.operator.lon },
      locationType: v.operator.location_type ?? null, id: v.operator.id ?? null,
      takeoffAltitudeM: v.operator.alt_takeoff_ft === undefined ? null : v.operator.alt_takeoff_ft * 0.3048,
      reportedAt: at(v.operator.seen),
    } : null,
  };
}

export const DEFAULT_RECEIVER_URL = "http://orecchino.local/data/remoteid.json";
// A missing .local name fails only when the lookup times out, so an absent default receiver is looked for again after this.
const ABSENT_RETRY_MS = 30_000;
const absentUntil = new Map<string, number>();

function setup(): DroneSnapshot {
  return { state: "setup", fetchedAt: Date.now(), receiverAt: null, messages: 0, drones: [] };
}

function readFeed(url: URL): Promise<DroneSnapshot> {
  // A receiver on the user's network is selected only by server configuration; it must never redirect.
  return memo(`drones:${url.href}`, 2000, async () => {
    const feed = await fetchJson("Drone Remote ID receiver", url, Feed, { redirect: "error", timeoutMs: 4000 });
    const fetchedAt = Date.now();
    const receiverAt = feed.now * 1000;
    // Relative ages decide report ordering. An old snapshot still carries its elapsed server age.
    const referenceAt = fetchedAt - Math.max(0, fetchedAt - receiverAt);
    return { state: "ready", fetchedAt, receiverAt, messages: feed.messages, drones: feed.drones.map((v) => detection(v, referenceAt)) } satisfies DroneSnapshot;
  }, 2000);
}

/** A configured receiver must answer. Without one, VANTAGE looks for an Orecchino receiver on the network and shows setup when none answers. */
export async function loadDrones(value = process.env.VANTAGE_DRONE_RECEIVER_URL, defaultUrl = DEFAULT_RECEIVER_URL): Promise<DroneSnapshot> {
  const configured = receiverUrl(value);
  if (configured) return await readFeed(configured);
  const url = new URL(defaultUrl);
  if (Date.now() < (absentUntil.get(url.href) ?? 0)) return setup();
  try {
    return await readFeed(url);
  } catch (err) {
    if (!(err instanceof HttpError) || (err.code !== "upstream_unreachable" && err.code !== "upstream_timeout")) throw err;
    absentUntil.set(url.href, Date.now() + ABSENT_RETRY_MS);
    return setup();
  }
}

export default defineSource({ routes: { "GET /": async () => json(await loadDrones()) } });
