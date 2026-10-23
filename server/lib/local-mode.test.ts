import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { pluginIds, privateEnabled } from "../../scripts/registry";
import { coreSource } from "../core";
import { discoverPluginSources } from "./router";

const initial = { local: process.env.VANTAGE_LOCAL, private: process.env.VANTAGE_PRIVATE };
afterEach(() => {
  for (const [key, value] of [["VANTAGE_LOCAL", initial.local], ["VANTAGE_PRIVATE", initial.private]] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});
const localPlugins = ["net", "wire", "control", "phone", "drones"];

describe("local feature selection", () => {
  test("removes host and LAN APIs and browser contributions by default, even with private requested", async () => {
    delete process.env.VANTAGE_LOCAL;
    process.env.VANTAGE_PRIVATE = "1";
    const [ids, sources] = await Promise.all([pluginIds(), discoverPluginSources(join(import.meta.dir, "../../plugins"))]);
    for (const id of localPlugins) {
      expect(ids).not.toContain(id);
      expect(sources.map(source => source.id)).not.toContain(id);
    }
    for (const id of ["city", "weather", "aircraft", "scan", "signal", "lens"]) expect(ids).toContain(id);
    expect(sources.map(source => source.id)).toContain("weather");
    expect(coreSource([]).routes["GET /iploc"]).toBeUndefined();
    expect(privateEnabled()).toBe(false);
  });

  test("restores local APIs and interface entries only with the explicit flag", async () => {
    process.env.VANTAGE_LOCAL = "1";
    delete process.env.VANTAGE_PRIVATE;
    const [ids, sources] = await Promise.all([pluginIds(), discoverPluginSources(join(import.meta.dir, "../../plugins"))]);
    for (const id of localPlugins) {
      expect(ids).toContain(id);
      expect(sources.map(source => source.id)).toContain(id);
    }
    expect(coreSource([]).routes["GET /iploc"]).toBeFunction();
    expect(privateEnabled()).toBe(false);
  });
});
