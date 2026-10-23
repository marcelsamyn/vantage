import { expect, test } from "bun:test";
import { defineSettings } from "./plugin";
import { readSetting, resetSettings, setSetting, settingValue } from "./settings";

const fields = defineSettings("demo", {
  mode: { kind: "choice", title: "Mode", options: [{ value: "a", label: "A" }, { value: "b", label: "B" }], default: "a" },
  kinds: { kind: "set", title: "Kinds", options: [{ value: "x", label: "X" }, { value: "y", label: "Y" }], default: ["x"] },
  on: { kind: "toggle", title: "On", default: true },
  size: { kind: "range", title: "Size", min: 1, max: 3, step: 0.5, default: 2 },
});

test("fields are stored under the plugin's id", () => {
  expect(fields.mode.key).toBe("demo.mode");
  expect(fields.size.plugin).toBe("demo");
});

test("a stored value an earlier build wrote falls back to the default when it no longer fits", () => {
  expect(settingValue(fields.mode, "b")).toBe("b");
  expect(settingValue(fields.mode, "removed-option")).toBe("a");
  expect(settingValue(fields.kinds, ["y", "x"])).toEqual(["y", "x"]);
  expect(settingValue(fields.kinds, ["x", "gone"])).toEqual(["x"]);
  expect(settingValue(fields.kinds, "x")).toEqual(["x"]);
  expect(settingValue(fields.on, "true")).toBe(true);
  expect(settingValue(fields.on, false)).toBe(false);
  expect(settingValue(fields.size, 9)).toBe(2);
  expect(settingValue(fields.size, Number.NaN)).toBe(2);
  expect(settingValue(fields.size, 1.5)).toBe(1.5);
  expect(settingValue(fields.size, undefined)).toBe(2);
});

test("a set value reads back until it is reset", () => {
  setSetting(fields.mode, "b");
  setSetting(fields.size, 3);
  expect(readSetting(fields.mode)).toBe("b");
  resetSettings([fields.mode]);
  expect(readSetting(fields.mode)).toBe("a");
  expect(readSetting(fields.size)).toBe(3);
});

test("a stored map that is not an object reads as no values", async () => {
  const stored = new Map<string, string>([["vantage:plugin-settings", "null"]]);
  const original = globalThis.localStorage;
  globalThis.localStorage = { getItem: (k: string) => stored.get(k) ?? null, setItem: (k: string, v: string) => void stored.set(k, v) } as unknown as Storage;
  try {
    const fresh = await import(`./settings?bad-store=${Date.now()}`);
    expect(fresh.readSetting(fields.mode)).toBe("a");
    expect(fresh.readSetting(fields.size)).toBe(2);
  } finally {
    globalThis.localStorage = original;
  }
});
