import { HttpError, diskMemo, fetchUpstream, log, memo, parseUpstream, z } from "../../server/kit";
import type { GroundStation, Observation, StationDetail, StationList } from "./types";

const SOURCE = "SatNOGS Network";
const API = "https://network.satnogs.org/api";
const HEADERS = { "user-agent": "VANTAGE/1.0 (personal dashboard; local)" };

const stationRow = z.object({
  id: z.number(),
  name: z.string(),
  altitude: z.number().nullable(),
  lat: z.number().nullable(),
  lng: z.number().nullable(),
  antenna: z.array(z.object({ band: z.string().nullable(), antenna_type_name: z.string().nullable() })),
  last_seen: z.string().nullable(),
  observations: z.number(),
  future_observations: z.number(),
  description: z.string().nullable(),
  owner: z.string().nullable(),
  // The API sends `false` for a station that has no rated observations yet.
  success_rate: z.union([z.number(), z.literal(false)]),
  status: z.enum(["Online", "Testing", "Offline"]),
});

function oneLine(s: string | null, max: number): string | null {
  const t = (s ?? "").replace(/\s+/g, " ").trim();
  return t ? t.slice(0, max) : null;
}

const StoredStations = z.object({
  stations: z.array(
    z.object({
      id: z.number(),
      name: z.string(),
      lat: z.number(),
      lon: z.number(),
      altitudeM: z.number(),
      status: z.enum(["online", "testing"]),
      antennas: z.array(z.string()),
      observations: z.number(),
      scheduled: z.number(),
      successRate: z.number().nullable(),
      lastSeen: z.number(),
      owner: z.string().nullable(),
      observing: z.object({ satellite: z.string(), endsAt: z.number() }).nullable(),
    }),
  ),
  offline: z.number(),
  fetchedAt: z.number(),
});

/**
 * Every registered station. The raw list is 3.5 MB and four in five stations are offline, so keep what is useful
 * and remember the count.
 */
function stations(): Promise<{ stations: GroundStation[]; offline: number; fetchedAt: number }> {
  return diskMemo("reach-satnogs-stations", 2 * 3_600_000, async () => {
    const res = await fetchUpstream(SOURCE, `${API}/stations/?format=json`, { headers: HEADERS, timeoutMs: 40_000 });
    const raw = parseUpstream(SOURCE, z.array(stationRow), await res.json());
    const list: GroundStation[] = [];
    for (const s of raw) {
      if (s.status === "Offline" || s.lat === null || s.lng === null) continue;
      list.push({
        id: s.id,
        name: s.name,
        lat: s.lat,
        lon: s.lng,
        altitudeM: s.altitude ?? 0,
        status: s.status === "Online" ? "online" : "testing",
        antennas: s.antenna.map((a) => [a.band, a.antenna_type_name].filter(Boolean).join(" · ")).filter(Boolean),
        observations: s.observations,
        scheduled: s.future_observations,
        successRate: s.success_rate === false ? null : s.success_rate,
        lastSeen: s.last_seen ? Date.parse(s.last_seen) : 0,
        owner: oneLine(s.owner, 220),
        observing: null,
      });
    }
    return { stations: list, offline: raw.filter((s) => s.status === "Offline").length, fetchedAt: Date.now() };
  }, StoredStations);
}

// ── Observations ──────────────────────────────────────────────────

const observationRow = z.object({
  id: z.number(),
  start: z.string(),
  end: z.string(),
  ground_station: z.number(),
  norad_cat_id: z.number(),
  payload: z.string().nullable(),
  waterfall: z.string().nullable(),
  demoddata: z.array(z.unknown()),
  archive_url: z.string().nullable(),
  tle0: z.string().nullable(),
  max_altitude: z.number().nullable(),
  transmitter_mode: z.string().nullable(),
  observation_frequency: z.number().nullable(),
  status: z.string(),
});
type ObservationRow = z.infer<typeof observationRow>;

const https = (u: string | null): string | null => (u && u.startsWith("https://") ? u : null);

function toObservation(o: ObservationRow): Observation {
  return {
    id: o.id,
    // TLE names carry a "0 " prefix for satellites with a provisional designation.
    satellite: (o.tle0 ?? `NORAD ${o.norad_cat_id}`).replace(/^0 /, ""),
    noradId: o.norad_cat_id,
    mode: o.transmitter_mode,
    frequencyMhz: o.observation_frequency ? o.observation_frequency / 1e6 : null,
    startsAt: Date.parse(o.start),
    endsAt: Date.parse(o.end),
    maxElevationDeg: o.max_altitude,
    waterfall: https(o.waterfall),
    audio: https(o.payload) ?? https(o.archive_url),
    decodedFrames: o.demoddata.length,
    page: `https://network.satnogs.org/observations/${o.id}/`,
  };
}

const NEXT_PAGE = /^https:\/\/network\.satnogs\.org\/api\/observations\/\?/;

/** Read up to `pages` pages of one observation query, following the API's own "next" links. */
async function observations(query: Record<string, string>, pages: number): Promise<ObservationRow[]> {
  const rows: ObservationRow[] = [];
  let url: string | null = `${API}/observations/?${new URLSearchParams({ ...query, format: "json" })}`;
  for (let page = 0; url && page < pages; page++) {
    const res = await fetchUpstream(SOURCE, url, { headers: HEADERS, timeoutMs: 25_000 });
    rows.push(...parseUpstream(SOURCE, z.array(observationRow), await res.json()));
    const next: string | undefined = /<([^>]+)>;\s*rel="next"/.exec(res.headers.get("link") ?? "")?.[1];
    url = next && NEXT_PAGE.test(next) ? next : null;
  }
  return rows;
}

const iso = (ms: number): string => new Date(ms).toISOString().replace(/\.\d+Z$/, "Z");

/** Stations recording a pass right now, found with one query for every observation that has begun and not ended. */
function runningNow(): Promise<Map<number, { satellite: string; endsAt: number }>> {
  return memo("reach-satnogs-running", 60_000, async () => {
    const now = iso(Date.now());
    const rows = await observations({ start__lt: now, end__gt: now }, 4);
    const out = new Map<number, { satellite: string; endsAt: number }>();
    for (const row of rows) {
      const o = toObservation(row);
      if (!out.has(row.ground_station)) out.set(row.ground_station, { satellite: o.satellite, endsAt: o.endsAt });
    }
    return out;
  });
}

export async function stationList(): Promise<StationList> {
  const base = await stations();
  let live: Map<number, { satellite: string; endsAt: number }> | null = null;
  let liveError: string | null = null;
  try {
    live = await runningNow();
  } catch (err) {
    liveError = err instanceof HttpError ? err.message : `${SOURCE} could not say which stations are recording`;
    log.warn("satnogs running check failed", { error: liveError });
  }
  return {
    fetchedAt: base.fetchedAt,
    offline: base.offline,
    liveError,
    stations: base.stations.map((s) => ({ ...s, observing: live?.get(s.id) ?? null })),
  };
}

/** Latest good recordings and the next few scheduled passes for one station. */
export function stationDetail(id: number): Promise<StationDetail> {
  return memo(`reach-satnogs-station:${id}`, 60_000, async () => {
    const now = Date.now();
    const recentRows = await observations({ ground_station: String(id), status: "good" }, 1);
    // The API lists newest first and cannot sort, so the window is kept small enough to hold a station's next passes.
    const upcomingRows = await observations({ ground_station: String(id), end__gt: iso(now), start__lt: iso(now + 4 * 3_600_000) }, 3);
    return {
      id,
      fetchedAt: now,
      recent: recentRows.map(toObservation).sort((a, b) => b.startsAt - a.startsAt).slice(0, 6),
      upcoming: upcomingRows.map(toObservation).sort((a, b) => a.startsAt - b.startsAt).slice(0, 6),
    } satisfies StationDetail;
  });
}
