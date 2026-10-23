import { expect, test } from "bun:test";
import { featureFilter, validateStyleMin, type FilterSpecification } from "@maplibre/maplibre-gl-style-spec";
import type { LayerSpecification } from "maplibre-gl";
import { flowLayers, type FlowStyle } from "./flow-style";

const DEFAULTS: FlowStyle = { measure: "relative", palette: "signal", roads: ["motorway", "main", "secondary", "street"], free: true, closures: true, glow: true, directions: true, width: 1, opacity: 90 };

/** Which of the style's layers would draw a road with these TomTom tags. */
function drawnBy(style: FlowStyle, tags: Record<string, unknown>): string[] {
  const feature = { type: 2 as const, properties: tags, geometry: [] };
  return flowLayers("flow", style)
    .filter((l): l is Extract<LayerSpecification, { filter?: unknown }> => "filter" in l)
    .filter((l) => featureFilter(l.filter as FilterSpecification, "filter").filter({ zoom: 14 }, feature))
    .map((l) => l.id.replace("flow-", ""));
}

test("every combination of settings builds a style MapLibre accepts", () => {
  for (const measure of ["relative", "absolute"] as const)
    for (const palette of ["signal", "ember", "ice"] as const)
      for (const flag of [true, false]) {
        const style: FlowStyle = { ...DEFAULTS, measure, palette, free: flag, closures: flag, glow: !flag, directions: flag, roads: flag ? DEFAULTS.roads : [] };
        const errors = validateStyleMin({
          version: 8,
          sources: { flow: { type: "vector", tiles: ["http://127.0.0.1/{z}/{x}/{y}"] } },
          layers: flowLayers("flow", style) as never,
        });
        expect(errors.map((e) => e.message)).toEqual([]);
      }
});

test("a jammed road glows, a closed road is dashed, and both respect the road filter", () => {
  const jam = { road_category: "primary", relative_speed: 0.2, absolute_speed: 8 };
  const shut = { road_category: "street", road_closure: true, relative_speed: 0, absolute_speed: 0 };
  expect(drawnBy(DEFAULTS, jam)).toEqual(["glow", "line"]);
  expect(drawnBy(DEFAULTS, shut)).toEqual(["closed"]);
  expect(drawnBy({ ...DEFAULTS, closures: false, glow: false }, shut)).toEqual(["line"]);
  expect(drawnBy({ ...DEFAULTS, roads: ["motorway", "main", "secondary"] }, shut)).toEqual([]);
  expect(drawnBy({ ...DEFAULTS, roads: ["motorway"] }, jam)).toEqual([]);
});

test("hiding free flow keeps slow and closed roads only", () => {
  const style = { ...DEFAULTS, free: false };
  expect(drawnBy(style, { road_category: "motorway", relative_speed: 0.95 })).toEqual([]);
  expect(drawnBy(style, { road_category: "motorway", relative_speed: 0.6 })).toEqual(["line"]);
  expect(drawnBy(style, { road_category: "motorway", road_closure: true, relative_speed: 0 })).toEqual(["closed"]);
});

test("a road category TomTom adds later counts as a local street", () => {
  expect(drawnBy(DEFAULTS, { road_category: "service", relative_speed: 0.7 })).toEqual(["line"]);
  expect(drawnBy({ ...DEFAULTS, roads: ["motorway", "main", "secondary"] }, { road_category: "service", relative_speed: 0.7 })).toEqual([]);
});
