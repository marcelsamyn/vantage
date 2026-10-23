import { expect, test } from "bun:test";
import type { LayerSpecification } from "maplibre-gl";
import { labelsAboveGround, mapLayerPlacement } from "./layer-order";

const base: LayerSpecification[] = [
  { id: "water", type: "fill", source: "base" },
  { id: "water_name", type: "symbol", source: "base" },
  { id: "road", type: "line", source: "base" },
  { id: "city-buildings-3d", type: "fill-extrusion", source: "base" },
  { id: "street_name", type: "symbol", source: "base" },
];

function insert(layers: readonly LayerSpecification[], specs: readonly LayerSpecification[], belowLabels = false): LayerSpecification[] {
  const placement = mapLayerPlacement(layers, specs, belowLabels);
  const index = placement.before === undefined ? layers.length : layers.findIndex((layer) => layer.id === placement.before);
  return [...layers.slice(0, index), ...placement.layers, ...layers.slice(index)];
}

test("aircraft trails appear above buildings and roads, below water and street labels", () => {
  const layers = insert(labelsAboveGround(base), [{ id: "aircraft-trails-line", type: "line", source: "aircraft" }], true);
  expect(layers.map((layer) => layer.id)).toEqual(["water", "road", "city-buildings-3d", "aircraft-trails-line", "water_name", "street_name"]);
});

test("rasters, areas, paths, base labels and markers keep their order after remounts", () => {
  const groups: { specs: LayerSpecification[]; below: boolean }[] = [
    { specs: [{ id: "weather-radar-0", type: "raster", source: "radar" }, { id: "weather-radar-1", type: "raster", source: "radar" }], below: true },
    { specs: [{ id: "warnings-fill", type: "fill", source: "warnings" }, { id: "warnings-edge", type: "line", source: "warnings" }], below: true },
    { specs: [{ id: "aircraft-trails-line", type: "line", source: "aircraft" }], below: true },
    { specs: [{ id: "aircraft-planes-halo", type: "circle", source: "planes" }, { id: "aircraft-planes-icon", type: "symbol", source: "planes" }], below: false },
    { specs: [{ id: "aircraft-emergencies-icon", type: "symbol", source: "emergencies" }], below: false },
  ];
  const mount = (order: typeof groups): LayerSpecification[] => order.reduce((layers, group) => insert(layers, group.specs, group.below), labelsAboveGround(base));
  const expected = mount(groups);
  expect(mount([...groups].reverse())).toEqual(expected);
  for (const group of groups) {
    const ids = new Set(group.specs.map((layer) => layer.id));
    expect(insert(expected.filter((layer) => !ids.has(layer.id)), group.specs, group.below)).toEqual(expected);
  }
  expect(expected.map((layer) => layer.id)).toEqual(["water", "road", "city-buildings-3d", "weather-radar-0", "weather-radar-1", "warnings-fill", "warnings-edge", "aircraft-trails-line", "water_name", "street_name", "aircraft-emergencies-icon", "aircraft-planes-halo", "aircraft-planes-icon"]);
});

test("empty groups and styles without labels remain valid", () => {
  expect(mapLayerPlacement(base, [])).toEqual({ before: undefined, layers: [] });
  expect(mapLayerPlacement([], [{ id: "path", type: "line", source: "path" }], true).before).toBeUndefined();
});

test("flight loops stay below their head markers even when mounted last", () => {
  const heads: LayerSpecification[] = [{ id: "aircraft-loop-heads-dot", type: "circle", source: "heads" }];
  const loops: LayerSpecification[] = [{ id: "aircraft-loops-glow", type: "line", source: "loops" }, { id: "aircraft-loops-core", type: "line", source: "loops" }];
  const ground = labelsAboveGround(base);
  const expected = insert(insert(ground, loops), heads);
  expect(insert(insert(ground, heads), loops)).toEqual(expected);
  expect(expected.slice(-3).map((layer) => layer.id)).toEqual(["aircraft-loops-glow", "aircraft-loops-core", "aircraft-loop-heads-dot"]);
});
