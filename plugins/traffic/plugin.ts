import { definePlugin } from "../../app/core/plugin";
import { MAP_INK } from "../city/extension";
import { glyph } from "./glyph";
import { FLOW_GROUP, settings } from "./settings";
import type { TrafficEvent } from "./types";
declare module "../../app/core/plugin" {
  interface EntityKinds {
    roadtraffic: TrafficEvent;
  }
}
export default definePlugin({
  id: "traffic",
  name: "Traffic",
  description: "Road disruptions and live traffic flow",
  contributes: {
    screen: {
      title: "Traffic",
      summary: "Road incidents, works and traffic flow coverage",
      glyph,
      section: "world",
      order: 65,
      view: () => import("./TrafficScreen"),
    },
    thingTypes: [
      {
        id: "roadtraffic",
        title: "Road disruptions",
        group: "live",
        order: 65,
        tone: "sodium",
        nearby: "see",
        mergeM: 0,
        description:
          "Current road incidents and works, from regional traffic feeds and optional TomTom coverage.",
        icon: () => import("./icons").then((m) => m.trafficIcon),
      },
    ],
    thingSources: [
      {
        id: "traffic.tomtom",
        title: "TomTom (requires key)",
        types: ["roadtraffic"],
        minZoom: 10,
        refreshMs: 300_000,
        attribution: "© TomTom",
        load: () => import("./things-tomtom"),
      },
      {
        id: "traffic.london",
        title: "Transport for London",
        types: ["roadtraffic"],
        refreshMs: 60_000,
        attribution: "Powered by TfL Open Data",
        load: () => import("./things-london"),
      },
      {
        id: "traffic.finland",
        title: "Fintraffic",
        types: ["roadtraffic"],
        refreshMs: 60_000,
        attribution: "Fintraffic / Digitraffic (CC BY 4.0)",
        load: () => import("./things-finland"),
      },
      {
        id: "traffic.netherlands",
        title: "NDW Netherlands",
        types: ["roadtraffic"],
        refreshMs: 60_000,
        attribution: "NDW",
        load: () => import("./things-netherlands"),
      },
      {
        id: "traffic.brussels",
        title: "Brussels Mobility",
        types: ["roadtraffic"],
        refreshMs: 3_600_000,
        attribution: "Brussels Mobility (CC0)",
        load: () => import("./things-brussels"),
      },
      {
        id: "traffic.france",
        title: "Bison Futé / DIR",
        types: ["roadtraffic"],
        refreshMs: 3_600_000,
        attribution: "Bison Futé / DIR (Licence Ouverte 2.0)",
        load: () => import("./things-france"),
      },
      {
        id: "traffic.austin",
        title: "Austin traffic reports",
        types: ["roadtraffic"],
        refreshMs: 300_000,
        attribution: "City of Austin / CTECC",
        load: () => import("./things-austin"),
      },
    ],
    mapLayers: [
      {
        id: "traffic.routes",
        title: "Road disruption paths",
        group: "live",
        minZoom: 9,
        swatch: MAP_INK.sodium,
        attribution:
          "© TomTom · Powered by TfL Open Data · Fintraffic / Digitraffic (CC BY 4.0) · NDW · Brussels Mobility (CC0) · Bison Futé / DIR (Licence Ouverte 2.0) · City of Austin / CTECC",
        description:
          "Incident paths and areas supplied by traffic feeds; select a path for its report.",
        view: () => import("./TrafficLayer"),
      },
      {
        id: "traffic.flow",
        title: "Traffic flow (TomTom)",
        group: "live",
        minZoom: 6,
        swatch: MAP_INK.mint,
        attribution: "© TomTom",
        description:
          "Live speed on every road TomTom measures, drawn in the colours you choose in Settings. Requires VANTAGE_TOMTOM_KEY on the server.",
        settings: FLOW_GROUP,
        view: () => import("./FlowLayer"),
      },
    ],
    profilers: { roadtraffic: () => import("./TrafficProfile") },
    settings: Object.values(settings),
  },
});
