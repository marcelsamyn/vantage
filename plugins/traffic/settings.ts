import { defineSettings } from "../../app/core/plugin";
import { MAP_INK } from "../city/extension";

/** Colour ramps for flow lines, from stopped traffic to free flow. */
export const FLOW_PALETTES = {
  signal: [MAP_INK.alarm, MAP_INK.sodium, MAP_INK.mint],
  ember: [MAP_INK.alarm, MAP_INK.sodium, MAP_INK.ash],
  ice: [MAP_INK.bone, MAP_INK.ice, MAP_INK.ash],
} as const;

export const FLOW_GROUP = "Traffic flow";

export const settings = defineSettings("traffic", {
  flowMeasure: {
    kind: "choice",
    group: FLOW_GROUP,
    title: "Colour roads by",
    options: [
      { value: "relative", label: "Against normal", description: "How much slower traffic moves than it does on an empty road." },
      { value: "absolute", label: "Actual speed", description: "The measured speed, from a standstill to 120 km/h and faster." },
    ],
    default: "relative",
  },
  flowPalette: {
    kind: "choice",
    group: FLOW_GROUP,
    title: "Colours",
    description: "From stopped traffic on the left to free flow on the right.",
    options: [
      { value: "signal", label: "Signal", description: "Red, amber and green.", swatches: FLOW_PALETTES.signal },
      { value: "ember", label: "Ember", description: "Slow roads glow; free roads fade to grey.", swatches: FLOW_PALETTES.ember },
      { value: "ice", label: "Ice", description: "Jams burn white; free roads cool to grey.", swatches: FLOW_PALETTES.ice },
    ],
    default: "signal",
  },
  flowRoads: {
    kind: "set",
    group: FLOW_GROUP,
    title: "Roads",
    description: "TomTom adds local streets from city zoom levels.",
    options: [
      { value: "motorway", label: "Motorways" },
      { value: "main", label: "Main roads" },
      { value: "secondary", label: "Secondary roads" },
      { value: "street", label: "Local streets" },
    ],
    default: ["motorway", "main", "secondary", "street"],
  },
  flowFree: {
    kind: "toggle",
    group: FLOW_GROUP,
    title: "Free-flowing roads",
    description: "Turn off to draw only roads where traffic is slower than normal.",
    default: true,
  },
  flowClosures: {
    kind: "toggle",
    group: FLOW_GROUP,
    title: "Mark closed roads",
    description: "Draw closed roads as a dashed red line instead of a stopped one.",
    default: true,
  },
  flowGlow: {
    kind: "toggle",
    group: FLOW_GROUP,
    title: "Glow on jams",
    description: "A soft halo under roads where traffic is at less than half its normal speed.",
    default: true,
  },
  flowDirections: {
    kind: "toggle",
    group: FLOW_GROUP,
    title: "Split directions",
    description: "From street zoom levels, draw each direction of a road on its own side.",
    default: true,
  },
  flowWidth: { kind: "range", group: FLOW_GROUP, title: "Line width", min: 0.5, max: 2, step: 0.1, default: 1, unit: "×" },
  flowOpacity: { kind: "range", group: FLOW_GROUP, title: "Opacity", min: 30, max: 100, step: 5, default: 90, unit: "%" },
});
