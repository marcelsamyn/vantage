import { lazy, type ComponentType, type LazyExoticComponent } from "react";
import type { Place } from "../../shared/location";
import type { Glyph } from "../ui/glyphs";
import type { NearbyContribution } from "./nearby";
import type { ThingSourceContribution, ThingTypeContribution } from "./things";

/**
 * VANTAGE plugin system.
 *
 * A plugin is a folder in `plugins/` whose `plugin.ts` default-exports `definePlugin({...})`. The registry is generated
 * from the folders, so adding a plugin edits no shared file. A plugin adds things to named extension points
 * ("contributions"). The kernel owns a few points (screens, tiles, commands, services, status items, profilers,
 * profiler sections, nearby things). Any plugin can open a new point by augmenting the `Contributions` interface — see
 * `plugins/city/extension.ts` for map layers.
 */

/** A component loaded on first use. Keeps each plugin's code out of the startup path. */
export type Lazy<P = object> = () => Promise<{ default: ComponentType<P> }>;

// ── Entities: things the Profiler can describe ────────────────────

/**
 * Map of entity kind → data carried by a reference to it. Plugins add kinds by augmenting:
 *
 *   declare module "../../app/core/plugin" { interface EntityKinds { aircraft: AircraftRef } }
 */
export interface EntityKinds {
  /** A point on Earth with a name. Owned by the kernel because every plugin can point at places. */
  place: Place;
}
export type EntityKind = Extract<keyof EntityKinds, string>;
export type Entity<K extends EntityKind = EntityKind> = { [P in K]: { kind: P; id: string; data: EntityKinds[P] } }[K];

export interface ProfilerProps<K extends EntityKind = EntityKind> {
  entity: Entity<K>;
  onClose: () => void;
}

/** Props of a profiler section: the entity whose profile it extends. */
export interface ProfilerSectionProps<K extends EntityKind = EntityKind> {
  entity: Entity<K>;
}

// ── Ordering ──────────────────────────────────────────────────────

const DEFAULT_ORDER = 50;

/** Lower `order` first (50 when unset), then by title, so equal orders never depend on folder names. */
export function byOrder(a: { order?: number; title: string }, b: { order?: number; title: string }): number {
  return (a.order ?? DEFAULT_ORDER) - (b.order ?? DEFAULT_ORDER) || a.title.localeCompare(b.title);
}

// ── Kernel extension points ───────────────────────────────────────

/** Sections of the rail, top to bottom. The rail draws a quiet rule between them. */
export const RAIL_SECTIONS = ["here", "world", "signals", "yours", "tools"] as const;
export type RailSection = (typeof RAIL_SECTIONS)[number];

/** A full screen with a slot in the rail. */
export interface ScreenContribution {
  title: string;
  /** One line shown in the rail tooltip and the command palette. */
  summary: string;
  /** The rail icon, drawn as data in the plugin's own glyph.ts. */
  glyph: Glyph;
  /**
   * Where the screen sits in the rail. "here": your surroundings at a glance. "world": the public world outside.
   * "signals": what you can see and hear through cameras, microphones and radio. "yours": your own Mac, network,
   * devices and data. "tools": utilities.
   */
  section: RailSection;
  /** Position within the section; lower comes first. Leave gaps (10, 20, 30) so a new screen fits between. */
  order?: number;
  /** Single key that opens the screen. */
  hotkey?: string;
  view: Lazy;
  /** Keep the screen mounted after leaving it (e.g. a map that is expensive to rebuild). */
  keepAlive?: boolean;
}

/** A live widget on the home briefing. */
export interface TileContribution {
  id: string;
  title: string;
  /** Grid columns the tile spans. */
  span?: 1 | 2;
  /** Lower comes first. */
  order?: number;
  view: Lazy;
}

interface CommandBase {
  id: string;
  title: string;
  hint?: string;
  keywords?: string[];
  /** When set, the palette asks for a value first, e.g. a host name to trace. */
  arg?: { placeholder: string };
}

/**
 * An entry in the command palette (⌘K). Either open the plugin's own screen with an intent
 * (preferred: declarative, and keeps manifests free of navigation calls), or run custom code.
 * The palette passes the typed value as the intent's `arg`.
 */
export type CommandContribution = CommandBase & ({ intent: { action: string }; run?: never } | { run: (arg: string | undefined) => void; intent?: never });

/** A headless component mounted at boot: watchers that raise feed events and alerts. */
export interface ServiceContribution {
  id: string;
  view: Lazy;
}

/** A small item in the top status bar. */
export interface StatusContribution {
  id: string;
  order?: number;
  view: Lazy;
}

export type ProfilerContributions = { [K in EntityKind]?: Lazy<ProfilerProps<K>> };

/**
 * A section in every profile of one entity kind, from any plugin: a heritage record on a place, an airframe's history
 * on an aircraft. The profile's owner changes nothing; every `ProfilerCard` in the profiler slot shows the sections
 * after its own content. A section renders nothing when it has nothing to say about that entity.
 */
export interface ProfilerSection<K extends EntityKind = EntityKind> {
  id: string;
  kind: K;
  /** Lower comes first. */
  order?: number;
  view: Lazy<ProfilerSectionProps<K>>;
}
/** One member per entity kind, so `kind` is checked and the view receives that kind's entity. */
export type ProfilerSectionContribution = { [K in EntityKind]: ProfilerSection<K> }[EntityKind];

// ── Settings ──────────────────────────────────────────────────────

interface SettingBase {
  title: string;
  /** One sentence on what the setting changes, shown under its title. */
  description?: string;
  /** A sub-heading inside the plugin's settings, for plugins with several areas. */
  group?: string;
}
export interface SettingOption<V extends string = string> {
  value: V;
  label: string;
  description?: string;
  /** Colours the option draws with, shown as a ramp next to its label. */
  swatches?: readonly string[];
}
export interface ToggleSetting extends SettingBase {
  kind: "toggle";
  default: boolean;
}
/** One of several options. */
export interface ChoiceSetting<V extends string = string> extends SettingBase {
  kind: "choice";
  options: readonly SettingOption<V>[];
  default: V;
}
/** Any number of the options. */
export interface SetSetting<V extends string = string> extends SettingBase {
  kind: "set";
  options: readonly SettingOption<V>[];
  default: readonly V[];
}
/** A number on a slider. The stored value is the one shown, followed by `unit`. */
export interface RangeSetting extends SettingBase {
  kind: "range";
  min: number;
  max: number;
  step: number;
  default: number;
  unit?: string;
}
export type SettingSpec = ToggleSetting | ChoiceSetting | SetSetting | RangeSetting;
/** A setting as a plugin contributes it: the spec plus where its value is stored. */
export type SettingField<S extends SettingSpec = SettingSpec> = S & { key: string; plugin: string };
export type SettingValue<S extends SettingSpec> = S extends ToggleSetting
  ? boolean
  : S extends ChoiceSetting<infer V>
    ? V
    : S extends SetSetting<infer V>
      ? readonly V[]
      : number;

/**
 * Declare a plugin's settings as data, in the plugin's own `settings.ts`. Components read a value with
 * `useSetting(settings.name)` from `app/core/settings`, typed from its options; the manifest contributes
 * `settings: Object.values(settings)` and the Settings screen draws the controls.
 */
export function defineSettings<const F extends Record<string, SettingSpec>>(plugin: string, fields: F): { [K in keyof F]: SettingField<F[K]> } {
  const out: Partial<{ [K in keyof F]: SettingField<F[K]> }> = {};
  for (const name of Object.keys(fields) as (keyof F & string)[]) out[name] = { ...fields[name], key: `${plugin}.${name}`, plugin };
  return out as { [K in keyof F]: SettingField<F[K]> };
}

/** Extension points. Kernel-owned points are listed here; plugins add their own by augmenting this interface. */
export interface Contributions {
  screen?: ScreenContribution;
  tiles?: TileContribution[];
  commands?: CommandContribution[];
  services?: ServiceContribution[];
  status?: StatusContribution[];
  profilers?: ProfilerContributions;
  profilerSections?: ProfilerSectionContribution[];
  /** Things to see or do near a position, for views such as City's "Around me". See `app/core/nearby.ts`. */
  nearby?: NearbyContribution[];
  /** A kind of thing on the map that any number of sources can report, such as drinking water. See `app/core/things.ts`. */
  thingTypes?: ThingTypeContribution[];
  /** A source of things, for any of the declared types. */
  thingSources?: ThingSourceContribution[];
  /** The plugin's settings, declared with `defineSettings` and shown on the Settings screen. */
  settings?: readonly SettingField[];
}

export interface Plugin<Id extends string = string> {
  /** Must equal the folder name; it is also the API prefix /api/<id>. */
  id: Id;
  name: string;
  description: string;
  contributes: Contributions;
}

export function definePlugin<const Id extends string>(plugin: Plugin<Id>): Plugin<Id> {
  return plugin;
}

// ── Registry ──────────────────────────────────────────────────────

let installed: readonly Plugin[] = [];

/** Called once by app/main.tsx with the list from plugins/index.ts. */
export function installPlugins(list: readonly Plugin[]): void {
  const ids = new Set<string>();
  const hotkeys = new Map<string, string>();
  const itemIds = new Map<string, string>();
  for (const p of list) {
    if (ids.has(p.id)) throw new Error(`Plugin id "${p.id}" is used twice`);
    ids.add(p.id);
    const key = p.contributes.screen?.hotkey;
    if (key) {
      const other = hotkeys.get(key);
      if (other) throw new Error(`Hotkey "${key}" is claimed by both "${other}" and "${p.id}"`);
      hotkeys.set(key, p.id);
    }
    // Contribution ids become React keys and stored preferences, so each must be unique within its point.
    for (const [point, items] of Object.entries(p.contributes)) {
      if (!Array.isArray(items)) continue;
      for (const item of items as unknown[]) {
        if (typeof item !== "object" || item === null || !("id" in item)) continue;
        const id = `${point}:${String(item.id)}`;
        const other = itemIds.get(id);
        if (other) throw new Error(`${point} id "${String(item.id)}" is used by both "${other}" and "${p.id}"`);
        itemIds.set(id, p.id);
      }
    }
  }
  installed = list;
}

export function allPlugins(): readonly Plugin[] {
  return installed;
}

export function pluginById(id: string): Plugin | undefined {
  return installed.find((p) => p.id === id);
}

type Point = keyof Contributions;
type ItemOf<K extends Point> = NonNullable<Contributions[K]> extends readonly (infer I)[] ? I : NonNullable<Contributions[K]>;

export interface Contributed<K extends Point> {
  plugin: Plugin;
  item: ItemOf<K>;
}

/** Every contribution to one extension point, across all plugins, in plugin (folder name) order. Arrays are flattened. */
export function contributions<K extends Point>(point: K): Contributed<K>[] {
  const out: Contributed<K>[] = [];
  for (const plugin of installed) {
    const value = plugin.contributes[point];
    if (value === undefined) continue;
    if (Array.isArray(value)) for (const item of value) out.push({ plugin, item: item as ItemOf<K> });
    else out.push({ plugin, item: value as ItemOf<K> });
  }
  return out;
}

/** Every screen in rail order: by section, then `order`, then title. */
export function screens(): Contributed<"screen">[] {
  return contributions("screen").sort((a, b) => RAIL_SECTIONS.indexOf(a.item.section) - RAIL_SECTIONS.indexOf(b.item.section) || byOrder(a.item, b.item));
}

export function profilerFor<K extends EntityKind>(kind: K): Lazy<ProfilerProps<K>> | undefined {
  for (const plugin of installed) {
    const loader = plugin.contributes.profilers?.[kind];
    if (loader) return loader as Lazy<ProfilerProps<K>>;
  }
  return undefined;
}

/** The sections contributed to profiles of `kind`, lowest `order` first. */
export function profilerSectionsFor(kind: EntityKind): ProfilerSection[] {
  // Each section kept here is for `kind`, so it accepts the entity being profiled. TypeScript cannot follow the
  // filter through the union of kinds, hence the widening.
  const matching = contributions("profilerSections").flatMap(({ item }) => (item.kind === kind ? [item as ProfilerSection] : []));
  return matching.sort((a, b) => (a.order ?? DEFAULT_ORDER) - (b.order ?? DEFAULT_ORDER) || a.id.localeCompare(b.id));
}

const lazyCache = new WeakMap<object, unknown>();

/** Turn a `Lazy` loader into a stable React.lazy component (one per loader). */
export function lazyView<P extends object>(loader: Lazy<P>): LazyExoticComponent<ComponentType<P>> {
  const hit = lazyCache.get(loader) as LazyExoticComponent<ComponentType<P>> | undefined;
  if (hit) return hit;
  const view = lazy(loader);
  lazyCache.set(loader, view);
  return view;
}
