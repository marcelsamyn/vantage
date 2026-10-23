import { useMemo } from "react";
import { create } from "zustand";
import { readStored, writeStored } from "../../app/core/hooks";
import type { NearbyState } from "../../app/core/nearby";
import { contributions } from "../../app/core/plugin";
import { thingTypes } from "../../app/core/things";
import type { SnapPoint } from "../../app/ui";
import type { Rect } from "./around";
import { aroundTab, type AroundTab } from "./around-view";
import type { LayerStatus } from "./extension";
import type { Route } from "./types";

const IDLE: LayerStatus = { loading: false, error: null, count: null };

/** What "Around me" found, published by the mode's controller for the list and the map controls. */
export interface AroundData extends NearbyState {
  radiusM: number;
}

/** Where the "Around me" drawer rests on a phone, and how much of it shows. */
export interface Drawer {
  snap: SnapPoint;
  shownPx: number;
  peekPx: number;
}

interface CityStore {
  /** Layer ids the user switched on, persisted per browser; null until the user changes anything (use defaults). */
  chosen: string[] | null;
  /** Layers switched on in this session that have not yet brought their data into view. Not persisted. */
  unframed: string[];
  /** Thing type ids the user switched on; null until the user changes anything (use the types' defaults). */
  chosenTypes: string[] | null;
  /** Thing source ids the user switched off. Every other source feeds the types it serves. */
  mutedSources: string[];
  /** Muted "Around me" provider ids; every provider is on until the viewer switches it off. */
  mutedNearby: string[];
  aroundTab: AroundTab;
  aroundExpanded: boolean;
  status: Record<string, LayerStatus>;
  route: Route | null;
  /** Set while "Around me" is on. */
  around: AroundData | null;
  /** The key of the chosen nearby item. */
  selected: string | null;
  /** The map keeps you in the middle until you pan it: always in "Around me", and in Map mode while it faces your way. */
  following: boolean;
  drawer: Drawer;
  /** The part of the map no panel covers, in pixels from the map's top-left corner; null until measured. */
  frame: Rect | null;
  toggle: (id: string, on: boolean) => void;
  toggleType: (id: string, on: boolean) => void;
  toggleSource: (id: string, on: boolean) => void;
  toggleNearby: (id: string, on: boolean) => void;
  setAroundTab: (tab: AroundTab) => void;
  report: (id: string, patch: Partial<LayerStatus>) => void;
  /** True once after the viewer switches layer `id` on; see `MapLayerProps.claimFraming`. */
  claimFraming: (id: string) => boolean;
  setRoute: (route: Route | null) => void;
}

/** Layers that are on by default. Read at call time, because this store can be created before plugins are installed. */
function defaults(): string[] {
  return contributions("mapLayers")
    .filter(({ item }) => item.defaultOn)
    .map(({ item }) => item.id);
}

/** Thing types that are on by default. */
function typeDefaults(): string[] {
  return thingTypes()
    .filter((t) => t.defaultOn)
    .map((t) => t.id);
}

/** Add or remove `id`, and remember the result for this browser. */
function stored(key: string, current: readonly string[], id: string, on: boolean): string[] {
  const set = new Set(current);
  if (on) set.add(id);
  else set.delete(id);
  const next = [...set];
  writeStored(key, next);
  return next;
}

export const useCity = create<CityStore>((set, get) => ({
  chosen: readStored<string[] | null>("city:layers", null),
  unframed: [],
  chosenTypes: readStored<string[] | null>("city:things", null),
  mutedSources: readStored<string[]>("city:things-muted", []),
  mutedNearby: readStored<string[]>("city:around-muted", []),
  aroundTab: aroundTab(readStored<unknown>("city:around-tab", "all")),
  aroundExpanded: false,
  status: {},
  route: null,
  around: null,
  selected: null,
  following: false,
  drawer: { snap: "peek", shownPx: 0, peekPx: 0 },
  frame: null,
  toggle: (id, on) => {
    const chosen = stored("city:layers", get().chosen ?? defaults(), id, on);
    const unframed = get().unframed.filter((u) => u !== id);
    set({ chosen, unframed: on ? [...unframed, id] : unframed, status: on ? get().status : { ...get().status, [id]: IDLE } });
  },
  toggleType: (id, on) => set({ chosenTypes: stored("city:things", get().chosenTypes ?? typeDefaults(), id, on) }),
  // Muting is the stored choice, so a source added later feeds its types until the viewer says otherwise.
  toggleSource: (id, on) => set({ mutedSources: stored("city:things-muted", get().mutedSources, id, !on) }),
  toggleNearby: (id, on) => set({ mutedNearby: stored("city:around-muted", get().mutedNearby, id, !on) }),
  setAroundTab: (aroundTab) => {
    writeStored("city:around-tab", aroundTab);
    set({ aroundTab, aroundExpanded: false, selected: null });
  },
  report: (id, patch) => set({ status: { ...get().status, [id]: { ...(get().status[id] ?? IDLE), ...patch } } }),
  claimFraming: (id) => {
    if (!get().unframed.includes(id)) return false;
    set({ unframed: get().unframed.filter((u) => u !== id) });
    return true;
  },
  setRoute: (route) => set({ route }),
}));

/** The set of switched-on layer ids. */
export function useEnabledLayers(): Set<string> {
  const chosen = useCity((s) => s.chosen);
  return useMemo(() => new Set(chosen ?? defaults()), [chosen]);
}

/** The set of switched-on thing type ids. */
export function useEnabledTypes(): Set<string> {
  const chosen = useCity((s) => s.chosenTypes);
  return useMemo(() => new Set(chosen ?? typeDefaults()), [chosen]);
}

/** The set of thing source ids the viewer switched off. */
export function useMutedSources(): Set<string> {
  const muted = useCity((s) => s.mutedSources);
  return useMemo(() => new Set(muted), [muted]);
}

/** The set of "Around me" provider ids the viewer switched off. */
export function useMutedNearby(): Set<string> {
  const muted = useCity((s) => s.mutedNearby);
  return useMemo(() => new Set(muted), [muted]);
}
