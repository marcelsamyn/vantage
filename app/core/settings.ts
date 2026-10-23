import { create } from "zustand";
import { readStored, writeStored } from "./hooks";
import type { SettingField, SettingSpec, SettingValue } from "./plugin";

export type Units = "metric" | "imperial";

interface Settings {
  units: Units;
  sound: boolean;
  volume: number;
}

interface SettingsStore extends Settings {
  set: (patch: Partial<Settings>) => void;
}

const DEFAULTS: Settings = { units: "metric", sound: true, volume: 0.5 };

export const useSettings = create<SettingsStore>((set, get) => ({
  ...DEFAULTS,
  ...readStored<Partial<Settings>>("settings", {}),
  set: (patch) => {
    set(patch);
    const { units, sound, volume } = get();
    writeStored("settings", { units, sound, volume } satisfies Settings);
  },
}));

// ── Plugin settings ───────────────────────────────────────────────

/** Values plugins declared with `defineSettings`, by field key. Absent means the default. */
const usePluginValues = create<{ values: Readonly<Record<string, unknown>> }>(() => ({ values: storedValues() }));

/** The stored map of values, or none when what is stored is not a plain object. Each value is checked on read. */
function storedValues(): Record<string, unknown> {
  const raw = readStored<unknown>("plugin-settings", {});
  return typeof raw === "object" && raw !== null && !Array.isArray(raw) ? { ...raw } : {};
}

/**
 * The stored value when it still fits the field, else the default. Values come from localStorage, which an earlier
 * build may have written with options this build no longer has.
 */
export function settingValue<S extends SettingSpec>(field: SettingField<S>, raw: unknown): SettingValue<S> {
  const spec: SettingSpec = field;
  const known = (v: unknown): boolean => "options" in spec && spec.options.some((o) => o.value === v);
  let fits: boolean;
  switch (spec.kind) {
    case "toggle":
      fits = typeof raw === "boolean";
      break;
    case "choice":
      fits = known(raw);
      break;
    case "set":
      fits = Array.isArray(raw) && raw.every(known);
      break;
    case "range":
      fits = typeof raw === "number" && Number.isFinite(raw) && raw >= spec.min && raw <= spec.max;
      break;
  }
  // `fits` checked the value against this field's own kind and options, which is what SettingValue<S> describes.
  return (fits ? raw : field.default) as SettingValue<S>;
}

export function useSetting<S extends SettingSpec>(field: SettingField<S>): SettingValue<S> {
  return settingValue(field, usePluginValues((s) => s.values[field.key]));
}

export function readSetting<S extends SettingSpec>(field: SettingField<S>): SettingValue<S> {
  return settingValue(field, usePluginValues.getState().values[field.key]);
}

function store(values: Record<string, unknown>): void {
  usePluginValues.setState({ values });
  writeStored("plugin-settings", values);
}

export function setSetting<S extends SettingSpec>(field: SettingField<S>, value: SettingValue<S>): void {
  store({ ...usePluginValues.getState().values, [field.key]: value });
}

/** Return the fields to their defaults. */
export function resetSettings(fields: readonly SettingField[]): void {
  const values = { ...usePluginValues.getState().values };
  for (const f of fields) delete values[f.key];
  store(values);
}

/** Whether any of the fields holds a value other than its default. */
export function useChanged(fields: readonly SettingField[]): boolean {
  return usePluginValues((s) => fields.some((f) => f.key in s.values && JSON.stringify(settingValue(f, s.values[f.key])) !== JSON.stringify(f.default)));
}
