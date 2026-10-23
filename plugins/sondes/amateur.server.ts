import { HttpError, fetchJson, z } from "../../server/kit";
import type { AmateurBalloon, AmateurFlight, BalloonLink, TrackPoint } from "./types";

/**
 * Balloons launched by radio amateurs, from SondeHub's amateur database (https://api.v2.sondehub.org/amateur).
 * The database keys every balloon by the call sign of its owner and stores the call sign of the receiving
 * station, its location and free-text comments next to each position. All of those describe people. The
 * schemas below list only the fields VANTAGE shows, and zod drops every other field while parsing, so no
 * call sign, comment or receiver position can reach the browser. The call sign is kept on the server to look up
 * a balloon's flight, and the browser sees an opaque id.
 */

const BASE = "https://api.v2.sondehub.org";

/** A balloon must be higher than this to count as flying; trackers on the ground report too. */
const AIRBORNE_M = 3000;
/** A balloon not heard for this long is dropped from the live list. */
const FRESH_MS = 24 * 3_600_000;
const SNAPSHOT_POINTS = 120;
const FLIGHT_POINTS = 500;

const Frame = z.object({
  datetime: z.string(),
  lat: z.number(),
  lon: z.number(),
  alt: z.number(),
  modulation: z.string().optional(),
  vel_h: z.number().nullish(),
  temp: z.number().nullish(),
  frequency: z.number().nullish(),
  days_aloft: z.number().nullish(),
  launch_date: z.string().nullish(),
});
type Frame = z.infer<typeof Frame>;

/** Payloads by call sign, each with its frames by time. */
const Telemetry = z.record(z.string(), z.record(z.string(), z.unknown()));

/** Opaque, stable id for a balloon. Not secret, but it is not the call sign. */
export function balloonId(callsign: string): string {
  return new Bun.CryptoHasher("sha256").update(`vantage-balloon:${callsign}`).digest("hex").slice(0, 8);
}

/** Reduce the many modulation strings ("WSPR (SA6BSS)", "Horus Binary v3") to a family. Some contain a call sign. */
export function linkOf(modulation: string | undefined): BalloonLink {
  const m = (modulation ?? "").toUpperCase();
  if (m.startsWith("WSPR")) return "WSPR";
  if (m.startsWith("APRS")) return "APRS";
  if (m.startsWith("HORUS")) return "Horus";
  if (m.startsWith("LORA")) return "LoRa";
  return "Other";
}

export function balloonName(id: string, link: BalloonLink): string {
  return `${link === "Other" ? "Radio" : link} balloon ${id.slice(0, 4).toUpperCase()}`;
}

const round = (n: number, places: number): number => Math.round(n * 10 ** places) / 10 ** places;
const wrap180 = (deg: number): number => ((((deg + 180) % 360) + 360) % 360) - 180;

/** Keep `max` evenly spaced points, always including the first and the last. */
export function thinEvenly<T>(points: readonly T[], max: number): T[] {
  if (points.length <= max) return [...points];
  const out: T[] = [];
  for (let i = 0; i < max; i++) out.push(points[Math.round((i * (points.length - 1)) / (max - 1))] as T);
  return out;
}

/** Times a path went round the Earth: the sum of its longitude steps over 360. Eastward is positive. */
export function lapsAround(points: readonly { lon: number }[]): number {
  let degrees = 0;
  for (let i = 1; i < points.length; i++) degrees += wrap180((points[i] as { lon: number }).lon - (points[i - 1] as { lon: number }).lon);
  return degrees / 360;
}

function framesOf(raw: Record<string, unknown>): { frame: Frame; at: number }[] {
  const out: { frame: Frame; at: number }[] = [];
  for (const item of Object.values(raw)) {
    const f = Frame.safeParse(item);
    const at = f.success ? Date.parse(f.data.datetime) : NaN;
    if (f.success && Number.isFinite(at)) out.push({ frame: f.data, at });
  }
  return out.sort((a, b) => a.at - b.at);
}

const toPoint = ({ frame, at }: { frame: Frame; at: number }): TrackPoint => ({ lat: round(frame.lat, 4), lon: round(frame.lon, 4), altM: Math.round(frame.alt), at });

/** Balloons in the air now, with their last three days. `callsigns` maps each id back to the call sign, for later lookups. */
export function toBalloons(raw: z.infer<typeof Telemetry>, now: number, callsigns: Map<string, string>): AmateurBalloon[] {
  const out: AmateurBalloon[] = [];
  for (const [callsign, frames] of Object.entries(raw)) {
    const all = framesOf(frames);
    const last = all[all.length - 1];
    if (!last || last.frame.alt < AIRBORNE_M || now - last.at > FRESH_MS) continue;
    const id = balloonId(callsign);
    const link = linkOf(last.frame.modulation);
    callsigns.set(id, callsign);
    out.push({
      id,
      name: balloonName(id, link),
      link,
      lat: last.frame.lat,
      lon: last.frame.lon,
      altM: Math.round(last.frame.alt),
      speedMs: last.frame.vel_h ?? null,
      tempC: last.frame.temp ?? null,
      frequencyMHz: last.frame.frequency ?? null,
      daysAloft: last.frame.days_aloft ?? null,
      launchDate: last.frame.launch_date ?? null,
      seenAt: last.at,
      track: thinEvenly(all.map(toPoint), SNAPSHOT_POINTS),
    });
  }
  return out.sort((a, b) => b.seenAt - a.seenAt);
}

export function toFlight(id: string, frames: Record<string, unknown>): AmateurFlight {
  const all = framesOf(frames);
  const first = all[0];
  const last = all[all.length - 1];
  if (!first || !last) throw new HttpError(404, "no_flight", "SondeHub has no recent positions for this balloon");
  const alts = all.map((p) => p.frame.alt);
  return {
    id,
    points: thinEvenly(all.map(toPoint), FLIGHT_POINTS),
    spanDays: round((last.at - first.at) / 86_400_000, 1),
    laps: round(lapsAround(all.map((p) => p.frame)), 2),
    maxAltM: Math.round(Math.max(...alts)),
    minAltM: Math.round(Math.min(...alts)),
  };
}

// ── Fetching ──────────────────────────────────────────────────────

/** Remembers which call sign is behind each id, filled whenever the live list loads. */
const callsigns = new Map<string, string>();

export async function loadBalloons(): Promise<AmateurBalloon[]> {
  const raw = await fetchJson("SondeHub amateur", `${BASE}/amateur/telemetry?duration=3d`, Telemetry, { timeoutMs: 40_000 });
  const readable = Object.values(raw).some((frames) => framesOf(frames).length > 0);
  if (Object.keys(raw).length > 0 && !readable) throw new HttpError(502, "upstream_shape", "SondeHub sent balloon data in a format VANTAGE does not recognise");
  return toBalloons(raw, Date.now(), callsigns);
}

/** A balloon's call sign by id. Fails when the id is not on the live list. */
export function callsignOf(id: string): string {
  const callsign = callsigns.get(id);
  if (!callsign) throw new HttpError(404, "unknown_balloon", "That balloon is no longer on the live list");
  return callsign;
}

export async function loadFlight(id: string, callsign: string): Promise<AmateurFlight> {
  // 366d is the longest window SondeHub accepts; older positions are kept at a coarser interval.
  const url = `${BASE}/amateur/telemetry?payload_callsign=${encodeURIComponent(callsign)}&duration=366d`;
  const raw = await fetchJson("SondeHub amateur", url, Telemetry, { timeoutMs: 30_000 });
  const frames = raw[callsign];
  if (!frames) throw new HttpError(404, "no_flight", "SondeHub has no recent positions for this balloon");
  return toFlight(id, frames);
}
