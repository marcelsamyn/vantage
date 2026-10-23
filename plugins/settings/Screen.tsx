import { motion } from "motion/react";
import { Fragment, useEffect, useId, useMemo, useRef, useState, type ReactElement, type RefObject } from "react";
import { useIntent } from "../../app/core/nav";
import { contributions, type ChoiceSetting, type Plugin, type RangeSetting, type SetSetting, type SettingField, type ToggleSetting } from "../../app/core/plugin";
import { resetSettings, setSetting, useChanged, useSetting, useSettings, type Units } from "../../app/core/settings";
import { Button, Empty, Page, Panel, Tag } from "../../app/ui";
import { ChoiceControl, RangeControl, SetControl, ToggleControl } from "./Controls";
import "./settings.css";

interface Section {
  plugin: Plugin;
  fields: SettingField[];
}

const GENERAL = "general";

/** Every plugin that declares settings, by name, each with its fields in declared order. */
function pluginSections(): Section[] {
  const byPlugin = new Map<string, Section>();
  for (const { plugin, item } of contributions("settings")) {
    const section = byPlugin.get(plugin.id) ?? { plugin, fields: [] };
    section.fields.push(item);
    byPlugin.set(plugin.id, section);
  }
  return [...byPlugin.values()].sort((a, b) => a.plugin.name.localeCompare(b.plugin.name));
}

/** Runs of fields under the same `group`, so a sub-heading appears once per group. */
function groupRuns(fields: readonly SettingField[]): { group: string | undefined; fields: SettingField[] }[] {
  const runs: { group: string | undefined; fields: SettingField[] }[] = [];
  for (const f of fields) {
    const last = runs.at(-1);
    if (last && last.group === f.group) last.fields.push(f);
    else runs.push({ group: f.group, fields: [f] });
  }
  return runs;
}

// Each kind reads its own value, so a hook is never called conditionally.
function StoredToggle({ field }: { field: SettingField<ToggleSetting> }): ReactElement {
  return <ToggleControl id={useId()} spec={field} value={useSetting(field)} onChange={(v) => setSetting(field, v)} />;
}
function StoredChoice({ field }: { field: SettingField<ChoiceSetting> }): ReactElement {
  return <ChoiceControl id={useId()} spec={field} value={useSetting(field)} onChange={(v) => setSetting(field, v)} />;
}
function StoredSet({ field }: { field: SettingField<SetSetting> }): ReactElement {
  return <SetControl id={useId()} spec={field} value={useSetting(field)} onChange={(v) => setSetting(field, v)} />;
}
function StoredRange({ field }: { field: SettingField<RangeSetting> }): ReactElement {
  return <RangeControl id={useId()} spec={field} value={useSetting(field)} onChange={(v) => setSetting(field, v)} />;
}
function StoredField({ field }: { field: SettingField }): ReactElement {
  switch (field.kind) {
    case "toggle":
      return <StoredToggle field={field} />;
    case "choice":
      return <StoredChoice field={field} />;
    case "set":
      return <StoredSet field={field} />;
    case "range":
      return <StoredRange field={field} />;
  }
}

const UNITS: ChoiceSetting<Units> = {
  kind: "choice",
  title: "Units",
  description: "For distances, speeds, heights and temperatures everywhere.",
  options: [
    { value: "metric", label: "Metric" },
    { value: "imperial", label: "Imperial" },
  ],
  default: "metric",
};
const SOUND: ToggleSetting = { kind: "toggle", title: "Interface sounds", description: "Clicks and chimes as you move around. M switches them anywhere.", default: true };
const VOLUME: RangeSetting = { kind: "range", title: "Volume", min: 0, max: 100, step: 5, default: 50, unit: "%" };

function General({ active }: { active: boolean }): ReactElement {
  const { units, sound, volume, set } = useSettings();
  const ids = { units: useId(), sound: useId(), volume: useId() };
  return (
    <Panel title="General" active={active}>
      <ChoiceControl id={ids.units} spec={UNITS} value={units} onChange={(v) => set({ units: v })} />
      <ToggleControl id={ids.sound} spec={SOUND} value={sound} onChange={(v) => set({ sound: v })} />
      {sound && <RangeControl id={ids.volume} spec={VOLUME} value={Math.round(volume * 100)} onChange={(v) => set({ volume: v / 100 })} />}
    </Panel>
  );
}

function PluginPanel({ section, active }: { section: Section; active: boolean }): ReactElement {
  const changed = useChanged(section.fields);
  return (
    <Panel
      title={section.plugin.name}
      active={active}
      actions={
        changed && (
          <>
            <Tag tone="sodium">Changed</Tag>
            <Button size="sm" variant="ghost" onClick={() => resetSettings(section.fields)}>
              Reset {section.plugin.name}
            </Button>
          </>
        )
      }
    >
      <p className="settings-about">{section.plugin.description}</p>
      {groupRuns(section.fields).map((run, i) => (
        <Fragment key={run.group ?? i}>
          {run.group && (
            <h3 className="v-eyebrow v-eyebrow--ice settings-group" data-group={run.group}>
              {run.group}
            </h3>
          )}
          {run.fields.map((f) => (
            <StoredField key={f.key} field={f} />
          ))}
        </Fragment>
      ))}
    </Panel>
  );
}

/** The last section whose top has passed a line a third of the way down the page, as it scrolls. */
function useCurrentSection(root: RefObject<HTMLElement | null>, ids: readonly string[]): string | undefined {
  const [current, setCurrent] = useState<string | undefined>(ids[0]);
  useEffect(() => {
    const el = root.current;
    const scroller = el?.closest(".v-page");
    if (!el || !scroller) return;
    const update = (): void => {
      const line = scroller.getBoundingClientRect().top + scroller.clientHeight / 3;
      let id: string | undefined;
      for (const node of el.querySelectorAll("[data-section]")) if (node.getBoundingClientRect().top <= line) id = node.getAttribute("data-section") ?? id;
      setCurrent(id ?? ids[0]);
    };
    update();
    scroller.addEventListener("scroll", update, { passive: true });
    return () => scroller.removeEventListener("scroll", update);
  }, [root, ids]);
  return current;
}

export default function SettingsScreen(): ReactElement {
  const sections = useMemo(pluginSections, []);
  const ids = useMemo(() => [GENERAL, ...sections.map((s) => s.plugin.id)], [sections]);
  const root = useRef<HTMLDivElement>(null);
  const current = useCurrentSection(root, ids);
  const [flash, setFlash] = useState<string | null>(null);

  const jump = (id: string, group?: string): void => {
    const section = root.current?.querySelector(`[data-section="${CSS.escape(id)}"]`);
    if (!section) return;
    const target = (group && section.querySelector(`[data-group="${CSS.escape(group)}"]`)) || section;
    target.scrollIntoView({ behavior: "smooth", block: "start" });
    setFlash(id);
  };
  // A link from elsewhere names a plugin, and optionally one group of its settings.
  useIntent("settings", ({ action, arg }) => jump(action, arg));
  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 1600);
    return () => clearTimeout(t);
  }, [flash]);

  const names = new Map([[GENERAL, "General"], ...sections.map((s) => [s.plugin.id, s.plugin.name] as const)]);
  return (
    <Page eyebrow="System" title="Settings" lede="Choose how VANTAGE measures, sounds and draws. Settings are kept in this browser.">
      <div className="settings" ref={root}>
        <nav className="settings-index" aria-label="Settings sections">
          {ids.map((id) => (
            <button key={id} type="button" className="settings-index__item" aria-current={current === id ? "location" : undefined} onClick={() => jump(id)}>
              {current === id && <motion.span layoutId="settings-index-tick" className="settings-index__tick" transition={{ type: "spring", duration: 0.3, bounce: 0 }} />}
              {names.get(id)}
            </button>
          ))}
        </nav>
        <div className="settings-sections">
          <section data-section={GENERAL} aria-label="General">
            <General active={flash === GENERAL} />
          </section>
          {sections.map((s) => (
            <section key={s.plugin.id} data-section={s.plugin.id} aria-label={s.plugin.name}>
              <PluginPanel section={s} active={flash === s.plugin.id} />
            </section>
          ))}
          {!sections.length && <Empty title="No plugin has settings yet">A plugin adds its settings with defineSettings in its settings.ts.</Empty>}
        </div>
      </div>
    </Page>
  );
}
