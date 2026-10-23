import type { LucideIcon } from "lucide-react";
import { useMemo } from "react";
import { create } from "zustand";
import { distanceM, type LatLon } from "../../shared/geo";
import { schemeOf, type ThingId } from "../../shared/thing-ids";
import type { Glyph } from "../ui/glyphs";
import type { Action } from "./action";
import type { NearbyKind } from "./nearby";
import { byOrder, contributions } from "./plugin";

/**
 * Things in the world, seen by more than one source.
 *
 * Open data says the same thing twice all the time: a drinking fountain is in OpenStreetMap and in the city's own
 * register, a Wi-Fi hotspot is mapped by volunteers and logged by the city. A `thingTypes` entry declares one kind of
 * thing once — "Drinking water" — and every plugin that can find one contributes a `thingSources` entry for it.
 * The kernel asks the sources, recognises the ones that mean the same thing, and merges them into a `FusedThing`
 * that keeps every source's own facts and actions:
 *
 *   // plugins/grid/plugin.ts
 *   thingTypes: [{ id: "water", title: "Drinking water", group: "services", tone: "ice",
 *                  description: "…", icon: () => import("./icons").then((m) => m.water) }],
 *   thingSources: [{ id: "grid.osm", title: "OpenStreetMap", types: ["water", "wifi"], minZoom: 14,
 *                    attribution: "© OpenStreetMap contributors", load: () => import("./things") }],
 *
 *   // plugins/dossier/plugin.ts — a second source for a type someone else declared
 *   thingSources: [{ id: "dossier.nasoni", title: "Rome nasoni", types: ["water"], load: () => import("./nasoni-things") }],
 *
 * Types and sources are independent: a source serves any subset of the types, and a type takes any number of sources.
 * A city with a dataset of its own joins in by adding a source, and nothing else changes.
 */

// ── What a source reports ─────────────────────────────────────────

/** The thing's colour on the map. These are the signal tokens: ice, mint, sodium, alarm, bone, fog. */
export type ThingTone = "ice" | "mint" | "sodium" | "alarm" | "bone" | "fog";

/** How the thing is doing, where a source knows: a scooter's battery, a station's bikes. */
export type ThingState = "ok" | "low" | "out" | "unknown";

/** SVG markup, a glyph (data on a 24 px grid) or a lucide-react icon, loaded with the view that draws it. */
export type ThingIcon = string | Glyph | LucideIcon;
export type ThingIconLoader = () => Promise<ThingIcon>;

/** One fact about a thing, in the words of the source that reported it. */
export type ThingRow = readonly [label: string, value: string];

export interface Thing {
  /** Stable within its source across refreshes. */
  id: string;
  /** A declared `thingTypes` id. */
  type: string;
  /**
   * Its own name, as on a sign or in a register: "Sint-Pieters", "Fontana di Trevi". Null when it has none. A word for
   * what it is ("Drinking fountain") is a `label`, because two different fountains both answer to it.
   */
  name: string | null;
  /** What to call it when it has no name: "Drinking fountain", "Police station". The type's title stands in otherwise. */
  label?: string;
  at: LatLon;
  /** One short line: "Free, open all day", "3 bikes, 5 docks". */
  detail?: string;
  state?: ThingState;
  /** Names an entry in the type's `variants`, for a type that covers a few shapes (police, fire, hospital). */
  variant?: string;
  /** What this source knows, shown under its name in the profile. */
  rows?: readonly ThingRow[];
  /** What this source lets you do with it: rent it, open its page, correct its record. */
  actions?: readonly Action[];
  /**
   * Every identifier the record carries in a register other sources share: "osm:node/123", "wikidata:Q42". See
   * `shared/thing-ids.ts`. Empty only when the record has none; position then decides alone.
   */
  match: readonly ThingId[];
  /** A picture of the thing, as a URL from the source or a path on this server. */
  image?: string;
  /** One sentence worth knowing about it, from the source that knows most about this kind of thing. */
  fact?: string;
}

/** The area a view is asking about. The field names match City's `MapView`, so a layer passes its view straight on. */
export interface ThingBox {
  west: number;
  south: number;
  east: number;
  north: number;
}

export interface ThingQuery {
  box: ThingBox;
  center: LatLon;
  zoom: number;
  /** The types the view is showing. Skip the work for the rest. */
  types: readonly string[];
  /** When the question is asked, epoch ms. */
  now: number;
}

/** Publish what you have. Call it again as more arrives, so a slow source fills the map while it works. */
export type ThingSink = (things: readonly Thing[]) => void;

/**
 * A source of things. It reuses what its plugin already fetches and caches, calls `emit` with what it has, and
 * resolves when it has nothing more to add for this query. Pass `signal` to every fetch.
 */
export type ThingProvider = (query: ThingQuery, emit: ThingSink, signal: AbortSignal) => Promise<void>;

// ── Extension points ──────────────────────────────────────────────

/** One kind of thing, declared once by the plugin that owns the domain. Sources from any plugin fill it. */
export interface ThingTypeContribution {
  /** Shared vocabulary, so other plugins can feed it: a plain lowercase word such as "water" or "wifi". */
  id: string;
  title: string;
  /** Id of a City `mapLayerGroups` entry: the heading it appears under in the layer panel. */
  group: string;
  /** One sentence for the layer panel: what this is. Each source credits its own data. */
  description: string;
  tone: ThingTone;
  icon: ThingIconLoader;
  /** Icons for the `variant` a thing may name, when one switch covers a few shapes. */
  variants?: Readonly<Record<string, ThingIconLoader>>;
  /** Its place in its group; lower comes first (50 when unset). */
  order?: number;
  defaultOn?: boolean;
  /** Show this kind on the map only at or above this zoom, regardless of its source. Nearby search is independent. */
  minZoom?: number;
  /**
   * The "Around me" tab that lists the nearest ones, or false for a kind that means nothing to someone walking by.
   * Every source of the type feeds it, with no code of its own.
   */
  nearby: NearbyKind | false;
  /**
   * How close two reports with no identifier in common must stand to be taken for one thing. Default `MERGE_M`.
   * Narrow it for a kind that stands close together, such as chargers in a car park.
   */
  mergeM?: number;
}

export interface ThingSourceContribution {
  /** Unique; prefix with your plugin id, e.g. "grid.osm". */
  id: string;
  /** Names the source under the type it feeds: "OpenStreetMap", "Rome nasoni". */
  title: string;
  /** The `thingTypes` ids this source can provide. */
  types: readonly string[];
  /** Credit shown on the map while this source has things on screen, as its terms ask. */
  attribution?: string;
  /** Stay quiet below this zoom, for a source that answers per area. */
  minZoom?: number;
  /** How often to ask again while the view is shown. Default `DEFAULT_REFRESH_MS`. Use your cache time or longer. */
  refreshMs?: number;
  /** Its place in the source list under a type, and which source leads a merge; lower comes first. */
  order?: number;
  load: () => Promise<{ default: ThingProvider }>;
}

declare module "./plugin" {
  interface EntityKinds {
    /** One thing on the City map, with everything each source says about it. */
    thing: FusedThing;
  }
}

/** Every declared type, in panel order. */
export function thingTypes(): ThingTypeContribution[] {
  return contributions("thingTypes")
    .map(({ item }) => item)
    .sort(byOrder);
}

/** Every source, in contribution order. The first source of a type leads the things it finds. */
export function thingSources(): ThingSourceContribution[] {
  return contributions("thingSources")
    .map(({ item }) => item)
    .sort(byOrder);
}

// ── Merging ───────────────────────────────────────────────────────

/** How close two reports with no identifier in common must stand before they are taken to mean the same thing. */
export const MERGE_M = 25;
export const DEFAULT_REFRESH_MS = 5 * 60_000;

const STATE_RANK: Record<ThingState, number> = { out: 0, low: 1, ok: 2, unknown: 3 };

/** What one source says about a fused thing. */
export interface ThingMember {
  /** The contributing source's id. */
  source: string;
  title: string;
  attribution: string | null;
  thing: Thing;
}

/** One thing, as every source that found it sees it. */
export interface FusedThing {
  /** Unique and stable while the leading source keeps reporting it: "<type>:<source>:<id>". */
  key: string;
  type: string;
  /** The first name a source gave it, or the type's title when none has one. */
  name: string;
  /** The mean of the positions its sources report, which are within `mergeM` of each other. */
  at: LatLon;
  detail: string | null;
  /** The worst state any source reports, so a dead scooter never looks charged. */
  state: ThingState;
  variant: string | null;
  image: string | null;
  fact: string | null;
  /** In source order; the first one leads the name and the key. */
  members: ThingMember[];
}

/** What a source answered for the current view. */
export interface ThingRun {
  things: readonly Thing[];
  loading: boolean;
  error: string | null;
}

/** A source's answer, with the source itself. */
export interface ThingBatch {
  source: ThingSourceContribution;
  things: readonly Thing[];
}

/** Letters and digits in any script, without case or accents, so "Café Nord" and "cafe-nord" agree. */
function plain(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

/** Two names agree when one source has none, or both mean the same word. */
function namesAgree(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return true;
  return plain(a) === plain(b);
}

/** Nothing the two sources say contradicts: no names that differ, and no different shapes under one switch (police, fire). */
function reportsAgree(a: Thing, b: Thing): boolean {
  return namesAgree(a.name, b.name) && (a.variant === undefined || b.variant === undefined || a.variant === b.variant);
}

/** The actions a fused thing offers, in source order, without repeating the same label twice. */
export function thingActions(thing: FusedThing): Action[] {
  const out: Action[] = [];
  const seen = new Set<string>();
  for (const m of thing.members) {
    for (const action of m.thing.actions ?? []) {
      if (seen.has(action.label)) continue;
      seen.add(action.label);
      out.push(action);
    }
  }
  return out;
}

/** One source's report, numbered in source order and then in the order the source gave it. */
interface Report {
  rank: number;
  type: ThingTypeContribution;
  member: ThingMember;
}

function fuse(reports: readonly Report[]): FusedThing {
  const members = [...reports].sort((a, b) => a.rank - b.rank).map((r) => r.member);
  const lead = members[0];
  const type = reports[0]?.type;
  if (!lead || !type) throw new Error("A fused thing needs at least one report");
  const lat = members.reduce((sum, m) => sum + m.thing.at.lat, 0) / members.length;
  const lon = members.reduce((sum, m) => sum + m.thing.at.lon, 0) / members.length;
  const worst = members.map((m) => m.thing.state ?? "unknown").sort((a, b) => STATE_RANK[a] - STATE_RANK[b])[0];
  return {
    key: `${type.id}:${lead.source}:${lead.thing.id}`,
    type: type.id,
    name: members.find((m) => m.thing.name !== null)?.thing.name ?? members.find((m) => m.thing.label !== undefined)?.thing.label ?? type.title,
    at: { lat, lon },
    detail: members.find((m) => m.thing.detail !== undefined)?.thing.detail ?? null,
    state: worst ?? "unknown",
    variant: members.find((m) => m.thing.variant !== undefined)?.thing.variant ?? null,
    image: members.find((m) => m.thing.image !== undefined)?.thing.image ?? null,
    fact: members.find((m) => m.thing.fact !== undefined)?.thing.fact ?? null,
    members,
  };
}

/**
 * The grid cell a position falls in, about `m` metres across, so a report is only compared with the few that could
 * be near it. A degree of longitude shrinks towards the poles, so the cell's width follows its latitude band, and a
 * report one `m` away is never more than one cell off.
 */
function cellOf(at: LatLon, m: number): { cy: number; cx: number } {
  const size = m / 111_320;
  const cy = Math.round(at.lat / size);
  // Read from the band rather than the report, so two reports in one band always measure their column the same way.
  const shrink = Math.max(0.05, Math.cos((cy * size * Math.PI) / 180));
  return { cy, cx: Math.round((at.lon * shrink) / size) };
}

/** Each source at most once: a source that lists a fountain twice means two fountains. */
function sharesSource(a: readonly Report[], b: readonly Report[]): boolean {
  return a.some((x) => b.some((y) => x.member.source === y.member.source));
}

/** Identifiers by scheme, so two groups can be compared register by register. */
function idsByScheme(reports: readonly Report[]): Map<string, Set<ThingId>> {
  const out = new Map<string, Set<ThingId>>();
  for (const r of reports) {
    for (const id of r.member.thing.match) {
      const scheme = schemeOf(id);
      out.set(scheme, (out.get(scheme) ?? new Set()).add(id));
    }
  }
  return out;
}

/** Both name the object in one register, and the codes differ: the register says they are two objects. */
function idsDisagree(a: readonly Report[], b: readonly Report[]): boolean {
  const left = idsByScheme(a);
  for (const [scheme, ids] of idsByScheme(b)) {
    const other = left.get(scheme);
    if (other && ![...ids].some((id) => other.has(id))) return true;
  }
  return false;
}

/**
 * Merge what the sources found into one thing each, in two passes.
 *
 * 1. Identifiers. Reports of one type that share a `match` identifier are one thing, however far apart their
 *    sources put it.
 * 2. Position, for the rest. Pairs of reports within the type's `mergeM` are tried nearest first, so a report joins
 *    the closest candidate rather than whichever was found first. Two groups join only when every report in one is
 *    within `mergeM` of every report in the other, so a row of fountains never chains into one; when their names and
 *    variants agree; and when no register gives them different codes. A source never meets itself in a group.
 *
 * Reports of an undeclared type are left out, because the panel has no switch for them. The things come back in
 * source order, led by the earliest source that reported each.
 */
export function fuseThings(batches: readonly ThingBatch[], types: readonly ThingTypeContribution[]): FusedThing[] {
  const byType = new Map(types.map((t) => [t.id, t]));
  const reports: Report[] = [];
  for (const { source, things } of batches) {
    for (const thing of things) {
      const type = byType.get(thing.type);
      if (type) reports.push({ rank: reports.length, type, member: { source: source.id, title: source.title, attribution: source.attribution ?? null, thing } });
    }
  }

  // Union-find over reports; each root holds its group.
  const parent = reports.map((_, i) => i);
  const groups = new Map<number, Report[]>(reports.map((r, i) => [i, [r]]));
  const root = (i: number): number => {
    let r = i;
    while (parent[r] !== r) r = parent[r] ?? r;
    parent[i] = r;
    return r;
  };
  const join = (i: number, j: number, allowed: (a: readonly Report[], b: readonly Report[]) => boolean): void => {
    const [ri, rj] = [root(i), root(j)];
    const a = groups.get(ri);
    const b = groups.get(rj);
    if (ri === rj || !a || !b || sharesSource(a, b) || !allowed(a, b)) return;
    parent[rj] = ri;
    groups.set(ri, [...a, ...b]);
    groups.delete(rj);
  };

  // 1. Identifiers.
  const firstWith = new Map<string, number>();
  reports.forEach((r, i) => {
    for (const id of r.member.thing.match) {
      const key = `${r.type.id}/${id}`;
      const seen = firstWith.get(key);
      if (seen === undefined) firstWith.set(key, i);
      else join(seen, i, () => true);
    }
  });

  // 2. Position: every close pair of reports from different sources, nearest first.
  const pairs: { i: number; j: number; d: number }[] = [];
  const cells = new Map<string, number[]>();
  reports.forEach((r, i) => {
    const mergeM = r.type.mergeM ?? MERGE_M;
    const { cy, cx } = cellOf(r.member.thing.at, mergeM);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        for (const j of cells.get(`${r.type.id}/${cy + dy}/${cx + dx}`) ?? []) {
          const other = reports[j];
          if (!other || other.member.source === r.member.source) continue;
          const d = distanceM(other.member.thing.at, r.member.thing.at);
          if (d <= mergeM) pairs.push({ i: j, j: i, d });
        }
      }
    }
    const key = `${r.type.id}/${cy}/${cx}`;
    const cell = cells.get(key);
    if (cell) cell.push(i);
    else cells.set(key, [i]);
  });
  pairs.sort((a, b) => a.d - b.d);
  for (const { i, j } of pairs) {
    join(i, j, (a, b) => {
      const mergeM = a[0]?.type.mergeM ?? MERGE_M;
      return (
        a.every((x) => b.every((y) => distanceM(x.member.thing.at, y.member.thing.at) <= mergeM && reportsAgree(x.member.thing, y.member.thing))) &&
        !idsDisagree(a, b)
      );
    });
  }

  return [...groups.values()]
    .map((g) => ({ first: Math.min(...g.map((r) => r.rank)), thing: fuse(g) }))
    .sort((a, b) => a.first - b.first)
    .map((g) => g.thing);
}

// ── What the sources have answered ────────────────────────────────

interface ThingStore {
  /** By source id. A source that is switched off or out of zoom is absent. */
  runs: Readonly<Record<string, ThingRun>>;
}

const IDLE: ThingRun = { things: [], loading: true, error: null };

const useThingStore = create<ThingStore>(() => ({ runs: {} }));

/** A source reports what it found, what it is doing, or how it failed. Partial updates merge. */
export function reportThings(source: string, patch: Partial<ThingRun>): void {
  const runs = useThingStore.getState().runs;
  useThingStore.setState({ runs: { ...runs, [source]: { ...(runs[source] ?? IDLE), ...patch } } });
}

/** A source stops answering: it was switched off, or the view left its zoom. */
export function forgetThings(source: string): void {
  const runs = useThingStore.getState().runs;
  if (!(source in runs)) return;
  const rest = { ...runs };
  delete rest[source];
  useThingStore.setState({ runs: rest });
}

export function useThingRuns(): Readonly<Record<string, ThingRun>> {
  return useThingStore((s) => s.runs);
}

/** One entry, so the layer that draws the things and the panel that counts them fuse them once between them. */
let cached: { runs: object; typeKey: string; result: FusedThing[] } | null = null;

/**
 * The things the switched-on sources have found, merged. The sources themselves run in City's things layer, so this
 * is empty while the map is closed. Fusing is shared between callers for as long as no source reports again.
 */
export function useFusedThings(enabledTypes: ReadonlySet<string>): FusedThing[] {
  const runs = useThingRuns();
  const types = useMemo(() => thingTypes().filter((t) => enabledTypes.has(t.id)), [enabledTypes]);
  const typeKey = types.map((t) => t.id).join(",");
  if (cached && cached.runs === runs && cached.typeKey === typeKey) return cached.result;
  const sources = thingSources();
  const batches = sources.flatMap((source) => {
    const run = runs[source.id];
    return run ? [{ source, things: run.things }] : [];
  });
  const result = fuseThings(batches, types);
  cached = { runs, typeKey, result };
  return result;
}
