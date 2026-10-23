import { definePlugin } from "../../app/core/plugin";
import { MAP_INK } from "../city/extension";

const OSM = "Street grid: © OpenStreetMap contributors";

export default definePlugin({
  id: "grid",
  name: "Street grid",
  description: "City infrastructure mapped by OpenStreetMap volunteers: cameras, signals, Wi-Fi, towers, the power grid and public services.",
  contributes: {
    mapLayers: [
      { id: "grid.cameras", title: "Surveillance cameras", group: "street-grid", swatch: MAP_INK.alarm, defaultOn: true, minZoom: 14, attribution: OSM, description: "Cameras mapped in OpenStreetMap, with the direction each one watches where known. Know where you are being filmed.", view: () => import("./layer-cameras") },
      { id: "grid.signals", title: "Traffic signals", group: "street-grid", swatch: MAP_INK.bone, defaultOn: true, minZoom: 15, attribution: OSM, description: "Every mapped traffic light. Locations only: their live state is not public.", view: () => import("./layer-signals") },
      { id: "grid.power", title: "Power grid", group: "street-grid", swatch: MAP_INK.sodium, minZoom: 13, attribution: OSM, description: "High-voltage lines and substations, as mapped in OpenStreetMap.", view: () => import("./layer-power") },
    ],
    thingTypes: [
      { id: "wifi", minZoom: 15, title: "Public Wi-Fi", group: "street-grid", tone: "ice", order: 60, nearby: "find", description: "Places that offer free Wi-Fi, from cafés and libraries to a city's own hotspots.", icon: () => import("./icons").then((m) => m.markSvg("wifi")) },
      { id: "tower", title: "Comms towers", group: "street-grid", tone: "sodium", order: 62, nearby: "see", description: "Masts and towers carrying mobile, radio and TV antennas.", icon: () => import("./icons").then((m) => m.markSvg("tower")) },
      { id: "bridge", title: "Movable bridges", group: "street-grid", tone: "sodium", order: 64, nearby: "see", description: "Bridges that lift, swing or bascule to let ships pass.", icon: () => import("./icons").then((m) => m.markSvg("bridge")) },
      {
        id: "emergency",
        title: "Police, fire, hospitals",
        group: "services",
        tone: "mint",
        order: 10,
        nearby: "find",
        description: "Emergency services and hospitals.",
        icon: () => import("./icons").then((m) => m.markSvg("hospital")),
        variants: {
          police: () => import("./icons").then((m) => m.markSvg("police")),
          fire: () => import("./icons").then((m) => m.markSvg("fire")),
          hospital: () => import("./icons").then((m) => m.markSvg("hospital")),
        },
      },
      { id: "aed", minZoom: 15, title: "Defibrillators", group: "services", tone: "mint", order: 12, nearby: "find", defaultOn: true, description: "Public AEDs. In a cardiac arrest, every minute counts.", icon: () => import("./icons").then((m) => m.markSvg("aed")) },
      { id: "water", minZoom: 15, title: "Drinking water", group: "services", tone: "ice", order: 14, nearby: "find", description: "Free drinking fountains and refill points, from every register that lists them.", icon: () => import("./icons").then((m) => m.markSvg("water")) },
      { id: "toilets", minZoom: 15, title: "Public toilets", group: "services", tone: "fog", order: 16, nearby: "find", description: "Public toilets, with fees and accessibility where known.", icon: () => import("./icons").then((m) => m.markSvg("toilets")) },
      { id: "ev", title: "EV charging", group: "services", tone: "mint", order: 18, nearby: "find", description: "Electric vehicle charging stations.", icon: () => import("./icons").then((m) => m.markSvg("ev")) },
      { id: "station", title: "Stations", group: "services", tone: "bone", order: 20, nearby: "go", description: "Rail and metro stations.", icon: () => import("./icons").then((m) => m.markSvg("station")) },
    ],
    thingSources: [
      {
        id: "grid.osm",
        title: "OpenStreetMap",
        types: ["wifi", "tower", "bridge", "emergency", "aed", "water", "toilets", "ev", "station"],
        order: 10,
        minZoom: 14,
        refreshMs: 30 * 60_000,
        attribution: OSM,
        load: () => import("./things"),
      },
    ],
    profilers: { grid: () => import("./GridProfile") },
    nearby: [{ id: "grid.cameras", title: "Surveillance cameras", order: 70, refreshMs: 30 * 60_000, attribution: "Street grid: © OpenStreetMap contributors", load: () => import("./nearby") }],
    commands: [
      { id: "grid.aed", title: "Find the nearest defibrillator", hint: "Opens it and shows a walking route", keywords: ["aed", "heart", "emergency", "cpr"], run: () => void import("./nearest").then((m) => m.findNearest("aed")) },
      { id: "grid.water", title: "Find drinking water nearby", keywords: ["fountain", "refill", "thirsty"], run: () => void import("./nearest").then((m) => m.findNearest("water")) },
      { id: "grid.toilets", title: "Find a public toilet", keywords: ["wc", "restroom", "bathroom"], run: () => void import("./nearest").then((m) => m.findNearest("toilets")) },
      { id: "grid.ev", title: "Find an EV charger", keywords: ["electric", "car", "charge"], run: () => void import("./nearest").then((m) => m.findNearest("ev")) },
      { id: "grid.wifi", title: "Find free Wi-Fi", keywords: ["internet", "hotspot"], run: () => void import("./nearest").then((m) => m.findNearest("wifi")) },
    ],
  },
});
