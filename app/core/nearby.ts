import type { LucideIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { bearingDeg, distanceM, type LatLon } from "../../shared/geo";
import type { Glyph } from "../ui/glyphs";
import type { Action } from "./action";
import { errorMessage } from "./api";
import { useNow, useRunning } from "./hooks";
import { byOrder, contributions, type Entity } from "./plugin";

/**
 * Things to see or do near a position. Any plugin contributes a provider to the `nearby` point; a view such as
 * City's "Around me" mode asks every provider through `useNearby`, which merges, scores and caps the answers.
 *
 *   nearby: [{ id: "bikes.nearby", title: "Bike share", order: 20, load: () => import("./nearby") }]
 *
 * The module's default export is a `NearbyProvider`. It adapts data its plugin already fetches and caches, so asking
 * it again costs next to nothing upstream.
 */

export interface NearbyQuery {
  /** Where to look from. It moves only when you move a fair part of the radius, so providers can cache by it. */
  at: LatLon;
  /** How far to look, in metres. Positioned items further away are dropped. */
  radiusM: number;
  /** When the question is asked, epoch ms. */
  now: number;
}

/**
 * What a thing near you is for, which decides the tab it appears in.
 *  - do: act on it now from the phone: listen to a microphone, tune a receiver, leave a map note, play a stream.
 *  - go: ways to move on: departures, bikes.
 *  - find: amenities: drinking water, toilets, Wi-Fi, defibrillators, chargers.
 *  - see: things to look at: landmarks, live cameras, sightings, reports, aircraft and stations overhead, old maps of the spot, warnings.
 */
export type NearbyKind = "do" | "go" | "find" | "see";

/** The item's colour. Ice is left out on purpose: it marks you and your selection. */
export type NearbyTone = "mint" | "sodium" | "alarm" | "fog";

/** A plugin glyph (data on a 24 px grid), a lucide-react icon component, or SVG markup, drawn in the item's tone. */
export type NearbyIcon = Glyph | LucideIcon | string;

export interface NearbyItem {
  /** Stable within its provider across refreshes. */
  id: string;
  title: string;
  /** One short line: "3 bikes, 5 docks", "Bus 64 in 4 min". */
  detail: string;
  /** Which tab lists it: see `NearbyKind`. */
  kind: NearbyKind;
  /**
   * Where it is. "overhead": in the sky above you, such as an aircraft or a satellite pass. "here": a condition of
   * the area you stand in, such as a weather warning. Neither is placed on the map.
   */
  at: LatLon | "overhead" | "here";
  icon: NearbyIcon;
  tone: NearbyTone;
  /** When it happens or begins, epoch ms: a departure, the rise of a pass. Without `until`, it is over a minute later. */
  startsAt?: number;
  /** When it ends or stops being true, epoch ms. The item disappears then. */
  until?: number;
  /** Happening now, with no end time to say so: a live stream, an aircraft in the sky. */
  live?: boolean;
  /** A small picture for the list: an image URL from the source, or a path on this server. */
  image?: string;
  /** Opens its profile when the item is chosen. */
  entity?: Entity;
  /** The one-tap action shown on the item. */
  primary: Action;
  more?: readonly Action[];
}

export type NearbyProvider = (query: NearbyQuery, signal: AbortSignal) => Promise<NearbyItem[]>;

/** A contribution to the `nearby` extension point. */
export interface NearbyContribution {
  /** Unique; prefix with your plugin id, e.g. "bikes.nearby". */
  id: string;
  /** Names the provider in status lines: "Bike share". */
  title: string;
  /** Its place in the list of providers that a view shows with their status; lower comes first (50 when unset). */
  order?: number;
  /** How often to ask again while the view is shown. Default one minute. */
  refreshMs?: number;
  /** Credit shown while the provider's items are on screen, as its sources ask: "Bikes: CityBikes". */
  attribution?: string;
  load: () => Promise<{ default: NearbyProvider }>;
}

// ── Scoring ───────────────────────────────────────────────────────

/** Walking pace for distances and walking times: 4.8 km/h. */
export const WALK_M_PER_MIN = 80;
/** Something that starts within this time counts as "soon". */
export const SOON_MS = 15 * 60_000;
/** A moment without an end, such as a departure, stays a minute after its time: clocks and buses drift. */
export const GRACE_MS = 60_000;
/** The most items of one kind a view gets; providers already keep their own lists short. */
export const NEARBY_CAP = 40;
/** Distance bands, in minutes of walking. Within a band, urgency decides. */
const BANDS_MIN = [2, 5, 10, 20, 40] as const;
const DEFAULT_REFRESH_MS = 60_000;
/** A provider that has not answered by then counts as failed, so the view can say what it found without it. */
export const PROVIDER_TIMEOUT_MS = 30_000;

/** "now": happening. "soon": starts within `SOON_MS`. "none": no hurry. */
export type Urgency = "now" | "soon" | "none";
const URGENCY_RANK: Record<Urgency, number> = { now: 0, soon: 1, none: 2 };

/** An item after merging: where it is from you, and how urgent. */
export interface PlacedItem extends NearbyItem {
  /** Unique across providers: "<contribution id>:<item id>". */
  key: string;
  /** The contribution that answered. */
  source: string;
  /** Metres from you; 0 for "overhead" and "here". */
  distanceM: number;
  /** Degrees clockwise from north, from you to it; null for "overhead" and "here". */
  bearing: number | null;
  urgency: Urgency;
}

export const walkMinutes = (m: number): number => m / WALK_M_PER_MIN;

export function isOver(item: Pick<NearbyItem, "startsAt" | "until">, now: number): boolean {
  if (item.until !== undefined) return item.until <= now;
  if (item.startsAt !== undefined) return item.startsAt + GRACE_MS < now;
  return false;
}

export function urgencyOf(item: Pick<NearbyItem, "startsAt" | "until" | "live">, now: number): Urgency {
  if (item.live) return "now";
  if (item.startsAt !== undefined && item.startsAt > now) return item.startsAt - now <= SOON_MS ? "soon" : "none";
  // Started and not over (over items are dropped), or in force until a known time.
  if (item.startsAt !== undefined || item.until !== undefined) return "now";
  return "none";
}

function band(m: number): number {
  const minutes = walkMinutes(m);
  const i = BANDS_MIN.findIndex((limit) => minutes < limit);
  return i === -1 ? BANDS_MIN.length : i;
}

/**
 * The order of the list: distance first, in bands of walking time (under 2 min, 5, 10, 20, 40, further), then
 * urgency within a band (happening now, starting soon, no hurry), then exact distance, then the soonest start.
 * Things overhead or all around you count as 0 m.
 */
export function compareNearby(a: PlacedItem, b: PlacedItem): number {
  return (
    band(a.distanceM) - band(b.distanceM) ||
    URGENCY_RANK[a.urgency] - URGENCY_RANK[b.urgency] ||
    a.distanceM - b.distanceM ||
    (a.startsAt ?? Number.POSITIVE_INFINITY) - (b.startsAt ?? Number.POSITIVE_INFINITY) ||
    a.title.localeCompare(b.title)
  );
}

/**
 * Merge the providers' answers: drop what is over or out of reach, measure from you, sort, and cap each kind on its own,
 * so a street full of things to see never pushes the nearest fountain out of Find.
 */
export function placeNearby(results: readonly { source: string; items: readonly NearbyItem[] }[], here: LatLon, radiusM: number, now: number, cap = NEARBY_CAP): PlacedItem[] {
  const out: PlacedItem[] = [];
  const seen = new Set<string>();
  for (const { source, items } of results) {
    for (const item of items) {
      const key = `${source}:${item.id}`;
      if (seen.has(key) || isOver(item, now)) continue;
      seen.add(key);
      const at = typeof item.at === "object" ? item.at : null;
      const d = at ? distanceM(here, at) : 0;
      if (d > radiusM) continue;
      out.push({ ...item, key, source, distanceM: d, bearing: at ? bearingDeg(here, at) : null, urgency: urgencyOf(item, now) });
    }
  }
  const kept: Record<NearbyKind, number> = { do: 0, go: 0, find: 0, see: 0 };
  return out.sort(compareNearby).filter((item) => kept[item.kind]++ < cap);
}

/** How far you move before providers are asked again: a fifth of the radius, at least 100 m. */
export const requeryDistanceM = (radiusM: number): number => Math.max(100, radiusM / 5);

// ── Hook ──────────────────────────────────────────────────────────

export interface ProviderStatus {
  id: string;
  title: string;
  attribution: string | null;
  loading: boolean;
  /** Why the last answer failed; the previous items stay. */
  error: string | null;
  count: number;
}

export interface NearbyState {
  /** Merged, scored and capped, nearest first. */
  items: PlacedItem[];
  providers: ProviderStatus[];
  /** Every provider has answered or failed at least once for the current position and radius. */
  settled: boolean;
  /** Ask every provider again now. */
  refresh: () => void;
}

interface Run {
  items: readonly NearbyItem[];
  error: string | null;
  loading: boolean;
  /** The query this run answered; settled once every provider answered the current one. */
  key: string | null;
}

const IDLE_RUN: Run = { items: [], error: null, loading: false, key: null };
const isAbort = (err: unknown): boolean => err instanceof DOMException && err.name === "AbortError";

/** Every `nearby` contribution, in provider order. */
export function nearbyContributions(): NearbyContribution[] {
  return contributions("nearby")
    .map(({ item }) => item)
    .sort(byOrder);
}

/**
 * Things near `here` from the given providers, usually `nearbyContributions()` less the ones the viewer switched off.
 * Keep the array's identity while the choice stays the same: a new array asks every provider again. Mount it only in
 * the view that shows them: providers run while that view is shown and the tab is visible, each on its own
 * `refreshMs`, and stop otherwise. A provider that fails keeps its previous items and reports its error in
 * `providers`; it never breaks the others.
 */
export function useNearby(here: LatLon | null, radiusM: number, sources: readonly NearbyContribution[]): NearbyState {
  const running = useRunning();
  const [runs, setRuns] = useState<Readonly<Record<string, Run>>>({});
  const [nonce, setNonce] = useState(0);
  const finished = useRef(new Map<string, { key: string; at: number }>());

  // Ask again only after moving a fair part of the radius: distances in the list follow you anyway.
  const anchorRef = useRef<LatLon | null>(null);
  if (here && (!anchorRef.current || distanceM(anchorRef.current, here) > requeryDistanceM(radiusM))) anchorRef.current = { lat: here.lat, lon: here.lon };
  const anchor = here ? anchorRef.current : null;
  const queryKey = anchor ? `${anchor.lat.toFixed(5)},${anchor.lon.toFixed(5)},${radiusM}` : null;

  useEffect(() => {
    if (!running || !anchor || !queryKey) return;
    let alive = true;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const controllers = new Set<AbortController>();
    const patch = (id: string, next: Partial<Run>): void => setRuns((prev) => ({ ...prev, [id]: { ...(prev[id] ?? IDLE_RUN), ...next } }));
    const refreshOf = (source: NearbyContribution): number => source.refreshMs ?? DEFAULT_REFRESH_MS;

    const schedule = (source: NearbyContribution, delayMs: number): void => {
      const timer = setTimeout(() => {
        timers.delete(timer);
        void run(source);
      }, delayMs);
      timers.add(timer);
    };

    const run = async (source: NearbyContribution): Promise<void> => {
      const controller = new AbortController();
      controllers.add(controller);
      patch(source.id, { loading: true });
      let timeout: ReturnType<typeof setTimeout> | undefined;
      let timedOut = false;
      // Not every fetcher honours the signal, so the timeout races the answer instead of waiting for the abort.
      const late = new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          timedOut = true;
          controller.abort();
          reject(new Error(`No answer within ${PROVIDER_TIMEOUT_MS / 1000} s`));
        }, PROVIDER_TIMEOUT_MS);
      });
      try {
        const provider = (await source.load()).default;
        const items = await Promise.race([provider({ at: anchor, radiusM, now: Date.now() }, controller.signal), late]);
        if (!alive) return;
        patch(source.id, { items, error: null, loading: false, key: queryKey });
      } catch (err) {
        if (!alive || (isAbort(err) && !timedOut)) return;
        patch(source.id, { error: timedOut ? `No answer within ${PROVIDER_TIMEOUT_MS / 1000} s` : errorMessage(err), loading: false, key: queryKey });
      } finally {
        clearTimeout(timeout);
        controllers.delete(controller);
      }
      finished.current.set(source.id, { key: queryKey, at: Date.now() });
      schedule(source, refreshOf(source));
    };

    // Coming back to the view asks only the providers whose answer has gone stale.
    for (const source of sources) {
      const last = finished.current.get(source.id);
      schedule(source, last?.key === queryKey ? Math.max(0, last.at + refreshOf(source) - Date.now()) : 0);
    }
    return () => {
      alive = false;
      for (const timer of timers) clearTimeout(timer);
      for (const controller of controllers) controller.abort();
    };
    // `queryKey` stands for `anchor` and `radiusM`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, queryKey, sources, nonce]);

  // Departures count down and passes begin: re-sort as time goes by.
  const now = useNow(15_000);
  const items = useMemo(
    () => (here ? placeNearby(sources.map((s) => ({ source: s.id, items: runs[s.id]?.items ?? [] })), here, radiusM, now) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [runs, here?.lat, here?.lon, radiusM, now, sources],
  );
  const providers = sources.map((s): ProviderStatus => {
    const r = runs[s.id] ?? IDLE_RUN;
    return { id: s.id, title: s.title, attribution: s.attribution ?? null, loading: r.loading, error: r.error, count: r.items.length };
  });
  const settled = queryKey !== null && sources.every((s) => runs[s.id]?.key === queryKey);
  const refresh = useCallback(() => {
    finished.current.clear();
    setNonce((n) => n + 1);
  }, []);

  return { items, providers, settled, refresh };
}
