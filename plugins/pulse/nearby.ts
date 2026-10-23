import { Bike, ParkingCircle, Ship, Waves } from "lucide-react";
import type { Action } from "../../app/core/action";
import type { NearbyItem, NearbyTone } from "../../app/core/nearby";
import { profile } from "../../app/core/profile";
import { distanceM, type LatLon } from "../../shared/geo";
import type { Bridge, BridgeFeed, BridgeOpening, CarPark, Counter, CounterFeed, ParkingFeed, RiverFeed, RiverGauge } from "./types";
import { STATUS_WORDS, levelText, parkTone, trendText } from "./words";

/** The nearest few of each kind are enough for a list; more would bury everything else near you. */
const PER_LAYER = 3;
/** A planned bridge opening is worth a look this long before it starts. */
const BRIDGE_SOON_MS = 6 * 3_600_000;
/** The rivers route refuses a box much wider than this. */
const RIVER_REACH_M = 8_000;

const walkTo = (to: LatLon & { name: string }): Action => ({
  label: "Walk there",
  run: () => import("../city/client").then((m) => m.routeTo(to, "foot")),
});

/** The `n` nearest within `radiusM`, nearest first. */
function nearest<T extends LatLon>(list: readonly T[], at: LatLon, radiusM: number, n = PER_LAYER): T[] {
  return list
    .map((x) => ({ x, d: distanceM(at, x) }))
    .filter((x) => x.d <= radiusM)
    .sort((a, b) => a.d - b.d)
    .slice(0, n)
    .map((x) => x.x);
}

const count = (n: number): string => n.toLocaleString("en");

// ── Car parks ─────────────────────────────────────────────────────

/** Open car parks that report their free spaces. A full one stays in the list, in alarm, so you know to skip it. */
export function parkingItems(feed: ParkingFeed, at: LatLon, radiusM: number): NearbyItem[] {
  const reporting = feed.parks.filter((p): p is CarPark & { free: number } => p.open && p.free !== null);
  return nearest(reporting, at, radiusM).map((p): NearbyItem => {
    const entity = { kind: "carpark", id: p.id, data: { park: p } } as const;
    const tone = parkTone(p);
    return {
      id: p.id,
      title: p.name,
      detail: `${p.free === 0 ? "Full" : `${count(p.free)} free`}${p.capacity !== null ? ` of ${count(p.capacity)} spaces` : ""}`,
      kind: "go",
      at: { lat: p.lat, lon: p.lon },
      icon: ParkingCircle,
      tone: tone === "closed" ? "fog" : tone,
      entity,
      primary: { label: "Show car park", run: () => profile.open(entity) },
      more: [walkTo(p)],
    };
  });
}

// ── River levels ──────────────────────────────────────────────────

const RIVER_TONE: Record<RiverGauge["status"], NearbyTone> = { normal: "mint", elevated: "sodium", high: "alarm", unknown: "fog" };

/** The box the rivers route takes: `radiusM` around you, rounded so a small step reuses the cached answer. */
export function riverBox(at: LatLon, radiusM: number): { west: number; south: number; east: number; north: number } {
  const r = Math.min(radiusM, RIVER_REACH_M);
  const dLat = r / 111_320;
  const dLon = r / (111_320 * Math.cos((at.lat * Math.PI) / 180));
  const round = (n: number): number => Math.round(n * 1000) / 1000;
  return { west: round(at.lon - dLon), south: round(at.lat - dLat), east: round(at.lon + dLon), north: round(at.lat + dLat) };
}

/** The nearest gauges that report a level. */
export function riverItems(feed: RiverFeed, at: LatLon, radiusM: number): NearbyItem[] {
  const reading = feed.gauges.filter((g): g is RiverGauge & { level: number } => g.level !== null);
  return nearest(reading, at, radiusM).map((g): NearbyItem => {
    const entity = { kind: "rivergauge", id: g.id, data: { gauge: g } } as const;
    const trend = trendText(g.trend3h);
    return {
      id: g.id,
      title: g.name,
      detail: `${levelText(g.level)}${trend ? `, ${trend}` : ""}${g.status === "unknown" ? "" : ` · ${STATUS_WORDS[g.status]}`}`,
      kind: "see",
      at: { lat: g.lat, lon: g.lon },
      icon: Waves,
      tone: RIVER_TONE[g.status],
      entity,
      primary: { label: "Show gauge", run: () => profile.open(entity) },
      more: [walkTo(g)],
    };
  });
}

// ── Bridge openings ───────────────────────────────────────────────

/** The opening under way, or the first planned one that is not over and starts soon. */
function openingOf(b: Bridge, now: number): BridgeOpening | null {
  if (b.now) return b.now;
  return b.upcoming.find((o) => o.from <= now + BRIDGE_SOON_MS && (o.until ?? o.from) > now) ?? null;
}

const OPENING_WORDS: Record<BridgeOpening["phase"], string> = {
  reported: "Reports itself open",
  window: "Open for a planned opening",
  planned: "Planned opening",
};

/** The nearest movable bridges that are open now or open within hours. */
export function bridgeItems(feed: BridgeFeed, at: LatLon, radiusM: number, now: number): NearbyItem[] {
  const opening = feed.bridges.flatMap((b) => {
    const o = openingOf(b, now);
    return o ? [{ ...b, opening: o }] : [];
  });
  return nearest(opening, at, radiusM).map((b): NearbyItem => {
    const { opening: o, ...bridge } = b;
    const entity = { kind: "bridgeopening", id: bridge.code, data: { bridge } } as const;
    const name = bridge.name ?? "Movable bridge";
    return {
      id: bridge.code,
      title: name,
      detail: OPENING_WORDS[o.phase],
      kind: "see",
      at: { lat: bridge.lat, lon: bridge.lon },
      icon: Ship,
      tone: bridge.now ? "sodium" : "fog",
      // An opening under way with no announced end has no time to count down to: it is live.
      ...(bridge.now && o.until === null ? { live: true } : { startsAt: o.from, ...(o.until !== null ? { until: o.until } : {}) }),
      entity,
      primary: { label: "Show opening", run: () => profile.open(entity) },
      more: [walkTo({ lat: bridge.lat, lon: bridge.lon, name })],
    };
  });
}

// ── Counters ──────────────────────────────────────────────────────

/** "Avenue des Arts 26 - 1000 Bruxelles" is the street at its number; the postcode follows. */
const streetOf = (name: string): string => name.replace(/\s+-\s+\d{4}\s.*$/, "");

/** The nearest bicycle counters that published a count for a day. */
export function counterItems(feed: CounterFeed, at: LatLon, radiusM: number): NearbyItem[] {
  const counted = feed.counters.filter((c): c is Counter & { day: number } => c.day !== null);
  return nearest(counted, at, radiusM).map((c): NearbyItem => {
    const entity = { kind: "counter", id: c.id, data: { counter: c } } as const;
    const day = `${count(c.day)} ${c.day === 1 ? "cyclist" : "cyclists"}`;
    const title = streetOf(c.name);
    return {
      id: c.id,
      title,
      detail: c.live ? `${day} today${c.hour !== null ? ` · ${count(c.hour)} this hour` : ""}` : `${day} on the latest published day`,
      kind: "see",
      at: { lat: c.lat, lon: c.lon },
      icon: Bike,
      tone: c.live ? "sodium" : "fog",
      entity,
      primary: { label: "Show counter", run: () => profile.open(entity) },
      more: [walkTo({ lat: c.lat, lon: c.lon, name: title })],
    };
  });
}
