import type { ExpressionSpecification, LayerSpecification } from "maplibre-gl";
import { MAP_INK } from "../city/extension";
import type { SettingValue } from "../../app/core/plugin";
import { FLOW_PALETTES, type settings } from "./settings";

/** The name of the layer inside TomTom's vector flow tiles. */
export const FLOW_SOURCE_LAYER = "Traffic flow";

type Value<K extends keyof typeof settings> = SettingValue<(typeof settings)[K]>;
export interface FlowStyle {
  measure: Value<"flowMeasure">;
  palette: Value<"flowPalette">;
  roads: Value<"flowRoads">;
  free: boolean;
  closures: boolean;
  glow: boolean;
  directions: boolean;
  width: number;
  opacity: number;
}

/** TomTom road categories in each group. A category TomTom adds later counts as a local street. */
const ROAD_GROUPS = {
  motorway: ["motorway", "motorway_link", "trunk", "trunk_link"],
  main: ["primary", "primary_link"],
  secondary: ["secondary", "secondary_link", "tertiary", "tertiary_link"],
} as const;

/** Traffic at this share of free-flow speed or above counts as free flowing. */
const FREE_FLOW = 0.85;
/** Below this share a road counts as jammed and glows. */
const JAM = 0.5;

const category: ExpressionSpecification = ["get", "road_category"];
const closed: ExpressionSpecification = ["==", ["get", "road_closure"], true];

function roadFilter(roads: FlowStyle["roads"]): ExpressionSpecification {
  const known = Object.values(ROAD_GROUPS).flat();
  const shown = Object.entries(ROAD_GROUPS).flatMap(([group, cats]) => (roads.some((r) => r === group) ? cats : []));
  const isKnown: ExpressionSpecification = ["in", category, ["literal", known]];
  const isShown: ExpressionSpecification = ["in", category, ["literal", shown]];
  return roads.includes("street") ? ["any", isShown, ["!", isKnown]] : isShown;
}

/** Thicker lines for bigger roads, scaled by zoom. */
function rank(): ExpressionSpecification {
  return ["match", category, [...ROAD_GROUPS.motorway], 1, [...ROAD_GROUPS.main], 0.8, ["secondary", "tertiary"], 0.62, ["secondary_link", "tertiary_link"], 0.45, 0.42];
}
function width(scale: number, factor = 1): ExpressionSpecification {
  const at = (px: number): ExpressionSpecification => ["*", rank(), px * scale * factor];
  return ["interpolate", ["exponential", 1.5], ["zoom"], 6, at(1), 10, at(2), 13, at(3.2), 16, at(6), 19, at(12)];
}

function colour(style: FlowStyle): ExpressionSpecification {
  const [slow, mid, fast] = FLOW_PALETTES[style.palette];
  return style.measure === "relative"
    ? ["interpolate", ["linear"], ["get", "relative_speed"], 0.2, slow, 0.55, mid, FREE_FLOW, fast]
    : ["interpolate", ["linear"], ["get", "absolute_speed"], 10, slow, 40, mid, 80, fast];
}

/** Roads carry one line per direction. Shift each to its own side of the road, by the side traffic drives on. */
function offset(style: FlowStyle): ExpressionSpecification | number {
  if (!style.directions) return 0;
  const side: ExpressionSpecification = ["case", ["==", ["get", "left_hand_traffic"], true], -1, 1];
  return ["interpolate", ["exponential", 1.5], ["zoom"], 13, 0, 16, ["*", side, rank(), 3 * style.width], 19, ["*", side, rank(), 6 * style.width]];
}

/** The MapLibre layers that draw TomTom flow tiles in this style, bottom first. */
export function flowLayers(source: string, style: FlowStyle): LayerSpecification[] {
  const base: ExpressionSpecification[] = [roadFilter(style.roads)];
  if (!style.free) base.push(["any", ["<", ["get", "relative_speed"], FREE_FLOW], closed]);
  const flowing: ExpressionSpecification = ["all", ...base, ...(style.closures ? [["!", closed] satisfies ExpressionSpecification] : [])];
  const common = { source, "source-layer": FLOW_SOURCE_LAYER, layout: { "line-cap": "round", "line-join": "round" } } as const;
  const opacity = style.opacity / 100;
  const layers: LayerSpecification[] = [];
  if (style.glow)
    layers.push({
      ...common,
      id: `${source}-glow`,
      type: "line",
      filter: ["all", flowing, ["<", ["get", "relative_speed"], JAM]],
      paint: { "line-color": colour(style), "line-width": width(style.width, 3.2), "line-blur": width(style.width, 2.4), "line-opacity": 0.35 * opacity, "line-offset": offset(style) },
    });
  layers.push({
    ...common,
    id: `${source}-line`,
    type: "line",
    filter: flowing,
    paint: { "line-color": colour(style), "line-width": width(style.width), "line-opacity": opacity, "line-offset": offset(style) },
  });
  if (style.closures)
    layers.push({
      ...common,
      id: `${source}-closed`,
      type: "line",
      filter: ["all", ...base, closed],
      layout: { "line-cap": "butt", "line-join": "round" },
      paint: { "line-color": MAP_INK.alarm, "line-width": width(style.width), "line-opacity": opacity, "line-dasharray": [1.2, 1.2], "line-offset": offset(style) },
    });
  return layers;
}
