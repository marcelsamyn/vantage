import { log } from "../../server/kit";
import { bearingDeg, distanceM, type LatLon } from "../../shared/geo";
import { bridgeFeed } from "./bridges.server";
import { counters } from "./counters.server";
import { carParks } from "./parking.server";
import { riverGauges } from "./rivers.server";
import type { Bridge, CarPark, Counter, Nearest, NearestItem, RiverGauge } from "./types";
import { STATUS_WORDS, levelText, parkTone } from "./words";

/** How far each kind of live thing is worth reporting, in metres. A car park 80 km away is not "nearest". */
const RANGE = { carpark: 20_000, counter: 20_000, river: 30_000, bridge: 40_000, signal: 30_000 } as const;

/** Where cities publish live data, for telling someone elsewhere where the nearest coverage is. */
const COVERED: { city: string; lat: number; lon: number; feeds: string[] }[] = [
  { city: "Hamburg", lat: 53.5503, lon: 9.992, feeds: ["live traffic lights"] },
  { city: "Amsterdam", lat: 52.3702, lon: 4.8952, feeds: ["movable bridges"] },
  { city: "Brussels", lat: 50.8466, lon: 4.3528, feeds: ["bicycle counters", "river levels"] },
  { city: "Ghent", lat: 51.0543, lon: 3.7174, feeds: ["car parks", "bicycle counters", "river levels"] },
  { city: "Paris", lat: 48.8566, lon: 2.3522, feeds: ["river levels"] },
  { city: "Milan", lat: 45.4642, lon: 9.19, feeds: ["river levels"] },
  { city: "Bologna", lat: 44.4949, lon: 11.3426, feeds: ["car parks"] },
  { city: "Zurich", lat: 47.3769, lon: 8.5417, feeds: ["car parks"] },
];

const HAMBURG = COVERED[0] as (typeof COVERED)[number];

function nearestBy<T extends LatLon>(here: LatLon, list: readonly T[], range: number): { item: T; d: number } | null {
  let best: { item: T; d: number } | null = null;
  for (const item of list) {
    const d = distanceM(here, item);
    if (d <= range && (!best || d < best.d)) best = { item, d };
  }
  return best;
}

function carparkItem(here: LatLon, parks: readonly CarPark[]): NearestItem | null {
  // A closed or silent car park is not a place to park, whatever its distance.
  const hit = nearestBy(here, parks.filter((p) => p.open && p.free !== null), RANGE.carpark);
  if (!hit) return null;
  const p = hit.item;
  const tone = parkTone(p);
  return {
    kind: "carpark",
    title: `Nearest car park: ${p.free} free`,
    detail: `${p.name}, ${p.city}${p.capacity !== null ? ` · ${p.capacity} spaces` : ""}`,
    distanceM: hit.d,
    tone: tone === "closed" ? "ice" : tone,
    lat: p.lat,
    lon: p.lon,
    entity: { kind: "carpark", id: p.id, data: { park: p } },
  };
}

function counterItem(here: LatLon, list: readonly Counter[]): NearestItem | null {
  const hit = nearestBy(here, list, RANGE.counter);
  if (!hit) return null;
  const c = hit.item;
  const short = c.name.replace(/\s+-\s+\d{4}\s.*$/, "");
  return {
    kind: "counter",
    title: c.hour !== null ? `Bike counter ${short}: ${c.hour} this hour` : `Bike counter ${short}: ${c.day ?? 0} on its latest published day`,
    detail: c.live ? `${c.city} · ${c.day ?? 0} so far today` : `${c.city} publishes monthly, so this is not live`,
    distanceM: hit.d,
    tone: c.live ? "sodium" : "ice",
    lat: c.lat,
    lon: c.lon,
    entity: { kind: "counter", id: c.id, data: { counter: c } },
  };
}

function riverItem(here: LatLon, gauges: readonly RiverGauge[]): NearestItem | null {
  const readable = gauges.filter((g) => g.level !== null);
  // A gauge with published thresholds says more than a ditch that has none, so it wins within a few kilometres of the closest one.
  const closest = nearestBy(here, readable, RANGE.river);
  if (!closest) return null;
  const withThresholds = nearestBy(here, readable.filter((g) => g.status !== "unknown"), closest.d + 4_000);
  const hit = withThresholds ?? closest;
  const g = hit.item;
  return {
    kind: "river",
    title: `${g.name}: ${levelText(g.level ?? 0)}, ${g.status === "unknown" ? "no alert levels published" : STATUS_WORDS[g.status]}`,
    detail: `${g.source}${g.river ? ` · ${g.river}` : ""}`,
    distanceM: hit.d,
    tone: g.status === "normal" ? "mint" : g.status === "elevated" ? "sodium" : g.status === "high" ? "alarm" : "ice",
    lat: g.lat,
    lon: g.lon,
    entity: { kind: "rivergauge", id: g.id, data: { gauge: g } },
  };
}

function bridgeItem(here: LatLon, bridges: readonly Bridge[], now: number): NearestItem | null {
  const hit = nearestBy(here, bridges, RANGE.bridge);
  if (!hit) return null;
  const b = hit.item;
  const next = b.upcoming[0];
  const name = b.name ?? "A movable bridge";
  const minutes = next ? Math.max(0, Math.round((next.from - now) / 60_000)) : null;
  return {
    kind: "bridge",
    title: b.now ? `${name} is open` : minutes !== null ? `${name} opens in ${minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`}` : `${name}: no opening planned`,
    detail: "Netherlands · planned openings from NDW",
    distanceM: hit.d,
    tone: b.now ? "sodium" : "ice",
    lat: b.lat,
    lon: b.lon,
    entity: { kind: "bridgeopening", id: b.code, data: { bridge: b } },
  };
}

async function settle<T>(what: string, task: Promise<T>): Promise<T | null> {
  try {
    return await task;
  } catch (err) {
    log.warn("pulse nearest: source failed", { source: what, error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

/** The live things nearest to a point, from whichever feeds cover it. */
export async function nearest(here: LatLon): Promise<Nearest> {
  const box = { west: here.lon - 0.3, east: here.lon + 0.3, south: here.lat - 0.2, north: here.lat + 0.2 };
  const [parks, bikes, rivers, bridges] = await Promise.all([settle("parking", carParks()), settle("counters", counters()), settle("rivers", riverGauges(box)), settle("bridges", bridgeFeed())]);
  const items: NearestItem[] = [];
  const push = (item: NearestItem | null): void => {
    if (item) items.push(item);
  };
  if (parks) push(carparkItem(here, parks.parks));
  if (bikes) push(counterItem(here, bikes));
  if (rivers) push(riverItem(here, rivers.gauges));
  if (bridges) push(bridgeItem(here, bridges.bridges, Date.now()));
  const hamburg = distanceM(here, HAMBURG);
  if (hamburg <= RANGE.signal) {
    items.push({ kind: "signal", title: "Live traffic lights: Hamburg publishes every signal", detail: "Switch on Live traffic lights on the City map and zoom in", distanceM: hamburg, tone: "mint", lat: HAMBURG.lat, lon: HAMBURG.lon, entity: null });
  }
  items.sort((a, b) => a.distanceM - b.distanceM);

  let closestCovered: Nearest["closestCovered"] = null;
  if (items.length === 0) {
    const best = COVERED.map((c) => ({ c, d: distanceM(here, c) })).sort((a, b) => a.d - b.d)[0];
    if (best) closestCovered = { city: best.c.city, distanceM: best.d, bearing: bearingDeg(here, best.c), feeds: best.c.feeds };
  }
  return { items, closestCovered };
}
