import { ChevronDown, SlidersHorizontal, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import type { Map as MapLibreMap } from "maplibre-gl";
import { useEffect, useMemo, useState, type ReactElement } from "react";
import { fmt } from "../../app/core/format";
import { useHotkey, useStoredState } from "../../app/core/hooks";
import { go } from "../../app/core/nav";
import { byOrder, contributions } from "../../app/core/plugin";
import { thingSources, thingTypes, useFusedThings, useThingRuns, type ThingRun, type ThingSourceContribution, type ThingTypeContribution } from "../../app/core/things";
import { IconButton, Sheet, Toggle, type SnapPoint } from "../../app/ui";
import type { MapLayerContribution } from "./extension";
import { useZoom } from "./LayerHost";
import { useCity, useEnabledLayers, useEnabledTypes, useMutedSources } from "./store";
import { TONE_INK } from "./things-ink";

/**
 * The layer panel. It lists two sorts of switch under the same headings: a layer, which one plugin draws on its own,
 * and a kind of thing, which every source that can report it feeds together. A kind with more than one source folds
 * open, so you can see which records are on and switch one off.
 */

/** A switch in the panel: a layer of its own, or a kind of thing with the sources that feed it. */
type Entry =
  | { kind: "layer"; id: string; title: string; order?: number; group: string; layer: MapLayerContribution }
  | { kind: "type"; id: string; title: string; order: number | undefined; group: string; type: ThingTypeContribution; sources: ThingSourceContribution[] };

interface Group {
  id: string;
  title: string;
  entries: Entry[];
}

function entriesOf(): Entry[] {
  const sources = thingSources();
  return [
    ...contributions("mapLayers").map(({ item }): Entry => ({ kind: "layer", id: item.id, title: item.title, group: item.group, layer: item })),
    ...thingTypes().map((type): Entry => ({ kind: "type", id: type.id, title: type.title, order: type.order, group: type.group, type, sources: sources.filter((s) => s.types.includes(type.id)) })),
  ];
}

/**
 * By `order` alone, which leaves the switches that do not set one in the order they came: layers in plugin order,
 * kinds of thing in the order `thingTypes()` gives them.
 */
const byPanelOrder = (a: Entry, b: Entry): number => (a.order ?? 50) - (b.order ?? 50);

/** Switches under the groups that plugins declare, in group order. Anything in a group nobody declared goes under "Other", last. */
function groupEntries(entries: readonly Entry[]): { groups: Group[]; orphans: Entry[] } {
  const declared = new Map(contributions("mapLayerGroups").map(({ item }) => [item.id, item]));
  const orphans = entries.filter((e) => !declared.has(e.group));
  const groups = [...declared.values()].sort(byOrder).map((g) => ({ id: g.id, title: g.title, entries: entries.filter((e) => e.group === g.id).sort(byPanelOrder) }));
  return { groups: [...groups, { id: "other", title: "Other", entries: orphans }].filter((g) => g.entries.length > 0), orphans };
}

function usePanel(): { groups: Group[]; total: number; onCount: number } {
  const enabledLayers = useEnabledLayers();
  const enabledTypes = useEnabledTypes();
  const entries = useMemo(entriesOf, []);
  const { groups, orphans } = useMemo(() => groupEntries(entries), [entries]);
  useEffect(() => {
    // Development only: a typo in `group` should be noticed by the switch's author, not by its users.
    if (!import.meta.hot) return;
    for (const e of orphans) console.warn(`Map ${e.kind} "${e.id}" names group "${e.group}", which no plugin declares in mapLayerGroups. It appears under "Other".`);
  }, [orphans]);
  const onCount = entries.filter((e) => (e.kind === "layer" ? enabledLayers.has(e.id) : enabledTypes.has(e.id))).length;
  return { groups, total: entries.length, onCount };
}

/** What a switch says on its right: a count, a reason it shows nothing, or nothing at all while it is off. */
function countLabel({ on, gated, loading, error, count }: { on: boolean; gated: boolean; loading: boolean; error: boolean; count: number | null }): string | undefined {
  if (!on) return undefined;
  if (gated) return "zoom in";
  if (error) return "error";
  if (count !== null) return fmt.int(count);
  return loading ? "…" : undefined;
}

function LayerSwitch({ map, layer }: { map: MapLibreMap; layer: MapLayerContribution }): ReactElement {
  const on = useEnabledLayers().has(layer.id);
  const status = useCity((s) => s.status[layer.id]);
  const toggle = useCity((s) => s.toggle);
  const zoom = useZoom(map);
  const count = countLabel({
    on,
    gated: zoom < (layer.minZoom ?? 0),
    loading: status?.loading ?? false,
    error: Boolean(status?.error),
    count: status?.loading && status.count === null ? null : (status?.count ?? null),
  });
  const owner = useMemo(() => contributions("mapLayers").find((c) => c.item.id === layer.id)?.plugin.id, [layer.id]);
  const tune = layer.settings;
  return (
    <div title={status?.error ? `${layer.description}\n\nProblem: ${status.error}` : layer.description} className={status?.error && on ? "city-layers__type city-layers__err" : "city-layers__type"}>
      <Toggle checked={on} onChange={(v) => toggle(layer.id, v)} label={layer.title} count={count} swatch={layer.swatch} />
      {tune && owner && (
        <button type="button" className="city-layers__fold" aria-label={`${layer.title} settings`} title={`${layer.title} settings`} onClick={() => go("settings", { action: owner, arg: tune })}>
          <SlidersHorizontal size={13} aria-hidden />
        </button>
      )}
    </div>
  );
}

const IDLE_RUN: ThingRun = { things: [], loading: false, error: null };

/** One kind of thing, with the sources that feed it folded underneath. */
function TypeSwitch({ map, type, sources, count, perSource }: { map: MapLibreMap; type: ThingTypeContribution; sources: readonly ThingSourceContribution[]; count: number; perSource: ReadonlyMap<string, number> }): ReactElement {
  const on = useEnabledTypes().has(type.id);
  const muted = useMutedSources();
  const toggleType = useCity((s) => s.toggleType);
  const toggleSource = useCity((s) => s.toggleSource);
  const runs = useThingRuns();
  const zoom = useZoom(map);
  const [open, setOpen] = useState(false);

  const live = sources.filter((s) => !muted.has(s.id));
  const typeInZoom = zoom >= (type.minZoom ?? 0);
  const inZoom = live.filter((s) => typeInZoom && zoom >= (s.minZoom ?? 0));
  const answered = inZoom.filter((s) => runs[s.id] !== undefined);
  const failed = answered.filter((s) => runs[s.id]?.error);
  const problem = failed.map((s) => `${s.title}: ${runs[s.id]?.error}`).join("\n");
  const loading = answered.some((s) => runs[s.id]?.loading);
  const label = countLabel({
    on,
    gated: !typeInZoom || (live.length > 0 && inZoom.length === 0),
    error: failed.length > 0 && failed.length === answered.length,
    loading,
    // Nothing found yet while a source is still looking is "…", not "0".
    count: answered.length === 0 || (loading && count === 0) ? null : count,
  });

  return (
    <div className={problem && on ? "city-layers__err" : undefined}>
      <div className="city-layers__type" title={problem ? `${type.description}\n\nProblem: ${problem}` : type.description}>
        <Toggle checked={on} onChange={(v) => toggleType(type.id, v)} label={type.title} count={label} swatch={TONE_INK[type.tone]} />
        {sources.length > 1 && (
          <button type="button" className="city-layers__fold" aria-expanded={open} onClick={() => setOpen(!open)}>
            <span className="v-eyebrow">
              {live.length}/{sources.length} sources
            </span>
            <ChevronDown size={12} style={{ rotate: open ? "0deg" : "-90deg" }} aria-hidden />
          </button>
        )}
      </div>
      {open && sources.length > 1 && (
        <div className="city-layers__sources">
          {sources.map((s) => {
            const run = runs[s.id] ?? IDLE_RUN;
            // What this source found of this kind, which is not everything it reported: a source feeds several kinds.
            const found = perSource.get(`${s.id}/${type.id}`) ?? 0;
            const quiet = !typeInZoom || zoom < (s.minZoom ?? 0);
            return (
              <div key={s.id} title={run.error ?? s.attribution ?? s.title}>
                <Toggle
                  checked={!muted.has(s.id)}
                  onChange={(v) => toggleSource(s.id, v)}
                  label={s.title}
                  count={muted.has(s.id) ? undefined : quiet ? "zoom in" : run.error ? "error" : run.loading && found === 0 ? "…" : fmt.int(found)}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** The switches, grouped. Shared by the desktop panel and the phone sheet. */
function LayerList({ map, groups, empty }: { map: MapLibreMap; groups: Group[]; empty: boolean }): ReactElement {
  const things = useFusedThings(useEnabledTypes());
  const runs = useThingRuns();
  const counts = useMemo(() => {
    const out = new Map<string, number>();
    for (const t of things) out.set(t.type, (out.get(t.type) ?? 0) + 1);
    return out;
  }, [things]);
  /** What each source found of each kind, keyed "<source>/<type>". */
  const perSource = useMemo(() => {
    const out = new Map<string, number>();
    for (const [id, run] of Object.entries(runs)) for (const thing of run.things) out.set(`${id}/${thing.type}`, (out.get(`${id}/${thing.type}`) ?? 0) + 1);
    return out;
  }, [runs]);
  return (
    <>
      {empty && <p className="city-layers__empty">No plugin contributes a map layer yet.</p>}
      {groups.map(({ id, title, entries }) => (
        <div key={id} className="city-layers__group">
          <div className="v-eyebrow city-layers__groupname">{title}</div>
          {entries.map((e) =>
            e.kind === "layer" ? (
              <LayerSwitch key={e.id} map={map} layer={e.layer} />
            ) : (
              <TypeSwitch key={e.id} map={map} type={e.type} sources={e.sources} count={counts.get(e.id) ?? 0} perSource={perSource} />
            ),
          )}
        </div>
      ))}
    </>
  );
}

/** Desktop: a panel in the left column that folds to its header. */
export function LayerPanel({ map }: { map: MapLibreMap }): ReactElement {
  const { groups, total, onCount } = usePanel();
  const [open, setOpen] = useStoredState("city:panel-open", true);
  return (
    <section className="v-panel city-layers" aria-label="Map layers">
      <button type="button" className="city-layers__head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="v-eyebrow">Layers</span>
        <span className="v-eyebrow city-layers__count">
          {onCount}/{total} on
        </span>
        <ChevronDown size={14} className="city-layers__chev" style={{ rotate: open ? "0deg" : "-90deg" }} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            className="city-layers__body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ type: "spring", duration: 0.35, bounce: 0 }}
          >
            <LayerList map={map} groups={groups} empty={total === 0} />
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

const SHEET_SNAPS: readonly SnapPoint[] = ["half", "full"];

/** Phone: the layers in a sheet over the map, closed by its button, a tap beside it, a drag down, or Escape. */
export function LayerSheet({ map, onClose }: { map: MapLibreMap; onClose: () => void }): ReactElement {
  const { groups, total, onCount } = usePanel();
  useHotkey((e) => e.key === "Escape", onClose, [onClose]);
  return (
    <Sheet
      label="Map layers"
      className="city-layersheet"
      snaps={SHEET_SNAPS}
      onClose={onClose}
      head={
        <header className="city-layersheet__head">
          <span className="v-eyebrow">Layers</span>
          <span className="v-eyebrow city-layers__count">
            {onCount}/{total} on
          </span>
          <IconButton label="Close layers" onClick={onClose}>
            <X size={16} />
          </IconButton>
        </header>
      }
    >
      <div className="city-layersheet__body">
        <LayerList map={map} groups={groups} empty={total === 0} />
      </div>
    </Sheet>
  );
}
