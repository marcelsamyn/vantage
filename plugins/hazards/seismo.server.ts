import { HttpError, fetchUpstream, log, memo } from "../../server/kit";
import { readMiniSeed, type Trace } from "./miniseed";
import { NODES, VOLCANOES, VOLCANO_NODE, parseChannels, summarise, type Candidate, type Node } from "./seismo";
import type { SeismoTrace, VolcanoSeismo } from "./types";

/**
 * Live ground motion from the nearest public seismic station.
 * The browser never names a URL: it gives a place, and the server picks a station from the fixed list of FDSN services in seismo.ts.
 */

const MAX_CANDIDATES = 12;
const WINDOW_MS = 10 * 60_000;
/** Networks publish with a short delay; asking for the very latest second returns an incomplete record. */
const LIVE_LAG_MS = 20_000;
const MAX_DOWNLOAD_BYTES = 8_000_000;

const describe = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** One node's stations around a place. The list changes rarely, so it is cached for hours; a failure is not cached. */
function nodeStations(node: Node, lat: number, lon: number): Promise<Candidate[]> {
  return memo(`seismo:stations:${node.id}:${lat.toFixed(1)},${lon.toFixed(1)}`, 6 * 3_600_000, async () => {
    const endAfter = new Date(Date.now() - 86_400_000).toISOString().slice(0, 19);
    const net = node.network ? `&network=${node.network}` : "";
    const query = `latitude=${lat}&longitude=${lon}&maxradius=${node.radiusDeg}${net}&level=channel&channel=${node.channels}&endafter=${endAfter}&format=text&nodata=404`;
    try {
      // INGV's station service needs several seconds even for a small list.
      const res = await fetchUpstream(`Seismic stations · ${node.id}`, `${node.base}/fdsnws/station/1/query?${query}`, { timeoutMs: 45_000 });
      return parseChannels(await res.text(), node, { lat, lon });
    } catch (err) {
      // 404 means "no station in range" on this node, which is an answer worth caching.
      if (err instanceof HttpError && err.code === "upstream_status" && /HTTP 404/.test(err.message)) return [];
      throw err;
    }
  });
}

/** Stations around a place, nearest first, from every node. A node that fails is left out of this answer and retried on the next. */
async function stationsNear(lat: number, lon: number): Promise<Candidate[]> {
  const results = await Promise.allSettled(NODES.map((n) => nodeStations(n, lat, lon)));
  for (const [i, r] of results.entries()) if (r.status === "rejected") log.warn("seismic station list failed", { node: NODES[i]?.id, error: describe(r.reason) });
  const seen = new Set<string>();
  return results
    .flatMap((r) => (r.status === "fulfilled" ? r.value : []))
    .sort((a, b) => a.station.distanceKm - b.station.distanceKm)
    .filter((c) => !seen.has(c.station.id) && seen.add(c.station.id));
}

async function download(c: Candidate, startMs: number, endMs: number): Promise<Trace | null> {
  const iso = (ms: number): string => new Date(ms).toISOString().slice(0, 23);
  const { station } = c;
  const query = `net=${station.network}&sta=${station.code}&loc=${c.location || "--"}&cha=${station.channel}&starttime=${iso(startMs)}&endtime=${iso(endMs)}&nodata=204`;
  let res: Response;
  try {
    res = await fetchUpstream(`Seismic waveform · ${station.id}`, `${c.node.base}/fdsnws/dataselect/1/query?${query}`, { timeoutMs: 20_000, headers: { accept: "application/vnd.fdsn.mseed, */*" } });
  } catch (err) {
    // An offline or restricted station answers with an error; the next one in line is tried.
    log.info("seismic station skipped", { station: station.id, error: describe(err) });
    return null;
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.length === 0 || bytes.length > MAX_DOWNLOAD_BYTES) return null;
  return readMiniSeed(bytes);
}

/** The station that answered last near a place, so the next request starts with it instead of waiting for offline ones to fail. */
const lastGood = new Map<string, string>();
/** Station id → time before which live requests skip it. */
const silentUntil = new Map<string, number>();
const SILENT_FOR_MS = 5 * 60_000;

/**
 * Ten minutes of ground motion from the first of `candidates` (nearest first) that has data. With a `place`, the next
 * request starts with the station that answered last instead of waiting for offline ones. A volcano passes none: it
 * always wants the station nearest the crater that is sending data, and offline ones are already skipped for a while.
 */
async function firstTrace(candidates: Candidate[], place: string | null, startMs: number, live: boolean): Promise<SeismoTrace> {
  const first = place === null ? undefined : lastGood.get(place);
  const now = Date.now();
  // Stations that sent nothing a moment ago are left out of live requests for a while: many hobbyist units are offline.
  const order = candidates
    .filter((c) => !live || (silentUntil.get(c.station.id) ?? 0) < now || c.station.id === first)
    .sort((a, b) => Number(b.station.id === first) - Number(a.station.id === first));
  const endMs = startMs + WINDOW_MS;
  const skipped: string[] = [];
  for (const c of order) {
    const trace = await download(c, startMs, endMs);
    const summary = trace && trace.samples.length >= trace.sampleRate * 30 ? summarise(trace, c.scale, startMs, endMs) : null;
    if (!trace || !summary) {
      skipped.push(c.station.id);
      if (live) silentUntil.set(c.station.id, now + SILENT_FOR_MS);
      continue;
    }
    if (place !== null) lastGood.set(place, c.station.id);
    return { station: c.station, startMs, endMs, skipped, ...summary };
  }
  throw new HttpError(
    404,
    "no_data",
    live ? `The nearest stations (${skipped.join(", ")}) sent no data just now. Try again in a minute.` : `The nearest stations (${skipped.join(", ")}) have no record of that time.`,
  );
}

/** The live window ends now; a past one starts a minute before `aroundMs`. */
const windowStart = (aroundMs: number | null): number => (aroundMs === null ? Math.floor((Date.now() - LIVE_LAG_MS - WINDOW_MS) / 10_000) * 10_000 : aroundMs - 60_000);

/**
 * Ten minutes of ground motion at the station nearest (lat, lon) that has data.
 * Without `aroundMs` the window ends now. With it, the window starts one minute before that moment (for the station nearest a quake).
 */
export function seismograph(lat: number, lon: number, aroundMs: number | null): Promise<SeismoTrace> {
  const startMs = windowStart(aroundMs);
  // The live window slides every 10 s, so its key leaves out the start time; the TTL keeps the cached window that fresh.
  const key = aroundMs === null ? `seismo:live:${lat.toFixed(2)},${lon.toFixed(2)}` : `seismo:trace:${lat.toFixed(2)},${lon.toFixed(2)}:${startMs}`;
  return memo(key, aroundMs === null ? 10_000 : 3_600_000, async () => {
    const candidates = (await stationsNear(lat, lon)).slice(0, MAX_CANDIDATES);
    if (candidates.length === 0) {
      throw new HttpError(404, "no_station", "No public seismic station was found within about 300 km. Try a place in Europe, North America or Japan, where networks publish open data.");
    }
    return firstTrace(candidates, `${lat.toFixed(1)},${lon.toFixed(1)}`, startMs, aroundMs === null);
  });
}

/** One volcano's nearest working seismometer to its crater, with the station's distance measured from the crater. */
function volcanoTrace(volcano: (typeof VOLCANOES)[number], aroundMs: number | null): Promise<SeismoTrace> {
  const startMs = windowStart(aroundMs);
  const key = aroundMs === null ? `seismo:volcano:${volcano.id}:live` : `seismo:volcano:${volcano.id}:${startMs}`;
  return memo(key, aroundMs === null ? 10_000 : 3_600_000, async () => {
    const candidates = [...(await nodeStations(VOLCANO_NODE, volcano.summit.lat, volcano.summit.lon))].sort((a, b) => a.station.distanceKm - b.station.distanceKm).slice(0, MAX_CANDIDATES);
    if (candidates.length === 0) throw new HttpError(404, "no_station", `INGV lists no working seismometer within 11 km of ${volcano.name}.`);
    return firstTrace(candidates, null, startMs, aroundMs === null);
  });
}

/** Ground motion at Italy's three monitored volcanoes. One that fails does not hide the others; its entry carries the reason. */
export async function volcanoSeismographs(aroundMs: number | null): Promise<VolcanoSeismo[]> {
  const results = await Promise.allSettled(VOLCANOES.map((v) => volcanoTrace(v, aroundMs)));
  return VOLCANOES.map((v, i): VolcanoSeismo => {
    const r = results[i];
    const base = { id: v.id, name: v.name, summitName: v.summitName, summit: v.summit };
    if (r?.status === "fulfilled") return { ...base, trace: r.value, error: null };
    const error = r?.reason instanceof Error ? r.reason.message : String(r?.reason);
    log.warn("volcano seismograph failed", { volcano: v.id, error });
    return { ...base, trace: null, error };
  });
}
