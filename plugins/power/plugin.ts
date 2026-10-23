import { definePlugin } from "../../app/core/plugin";
import { MAP_INK } from "../city/extension";
import { glyph } from "./glyph";

export default definePlugin({
  id: "power",
  name: "Power",
  description: "The European power grid: its 50 Hz heartbeat, what generates the electricity, day-ahead prices, Belgium's cross-border flows and nuclear reactors, gas entering Italy and Belgium, and live power cuts in Amsterdam.",
  contributes: {
    screen: {
      title: "Power",
      summary: "The grid that keeps the lights on",
      glyph,
      section: "world",
      order: 60,
      hotkey: "p",
      view: () => import("./Screen"),
    },
    tiles: [{ id: "power.tile", title: "Power grid", order: 6, view: () => import("./Tile") }],
    nearby: [{ id: "power.nearby", title: "Power cuts", order: 65, refreshMs: 60_000, attribution: "Power cuts: Liander via City of Amsterdam open data (CC BY)", load: () => import("./nearby") }],
    services: [{ id: "power.watch", view: () => import("./Watcher") }],
    mapLayers: [
      {
        id: "power.flows",
        title: "Cross-border power flows",
        group: "street-grid",
        swatch: MAP_INK.sodium,
        minZoom: 5,
        attribution: "Flows: Elia Open Data (Elia Open Data Licence)",
        description: "Electricity crossing Belgium's borders right now, drawn on Elia's 380 kV interconnector lines. Arrows point the way the power flows. Shows nothing outside Belgium and its neighbours; Luxembourg has no 380 kV link in the data.",
        view: () => import("./FlowsLayer"),
      },
      {
        id: "power.gas",
        title: "Gas flows",
        group: "street-grid",
        swatch: MAP_INK.sodium,
        minZoom: 4,
        attribution: "Gas: ENTSOG TP Physical Flow, https://transparency.entsog.eu/",
        description: "Natural gas coming into Italy and Belgium through its border pipelines and LNG terminals, hour by hour. Each arrow points the way the gas flows and grows with GWh/h. Shows Italy and Belgium only; Belgium's French and German borders publish no hourly flow.",
        view: () => import("./GasLayer"),
      },
      {
        id: "power.cuts",
        title: "Power cuts",
        group: "hazards",
        swatch: MAP_INK.alarm,
        minZoom: 4,
        attribution: "Power cuts: Liander via City of Amsterdam open data (CC BY)",
        description: "Today's power cuts on the Liander grid, as shaded areas: red for faults, amber for planned work, grey once fixed. Shows nothing outside the Amsterdam region; Rome and Brussels publish no live outage feed.",
        view: () => import("./CutsLayer"),
      },
    ],
    profilers: { gaspoint: () => import("./GasProfile"), powercut: () => import("./CutProfile") },
    commands: [
      { id: "power.open", title: "Open the power grid", keywords: ["electricity", "frequency", "50 hz", "blackout", "energy"], intent: { action: "open" } },
      { id: "power.flows", title: "Show cross-border power flows", keywords: ["interconnector", "belgium", "elia", "electricity"], run: () => void import("../city/client").then((m) => m.showLayer("power.flows")) },
    ],
  },
});
