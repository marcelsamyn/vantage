import { definePlugin } from "../../app/core/plugin";
import { MAP_INK } from "../city/extension";

export default definePlugin({
  id: "dossier",
  name: "Dossier",
  description: "Oddly specific public records about places: heritage files, street energy use, registered trees, Rome's parking and Wi-Fi, and what a city's public authorities are buying.",
  contributes: {
    profilerSections: [
      { id: "dossier.heritage", kind: "place", order: 30, view: () => import("./HeritageFact") },
      { id: "dossier.energy", kind: "place", order: 32, view: () => import("./EnergyFact") },
      { id: "dossier.trees", kind: "place", order: 34, view: () => import("./TreesFact") },
      { id: "dossier.parking", kind: "place", order: 36, view: () => import("./ParkingFact") },
      { id: "dossier.tenders", kind: "place", order: 38, view: () => import("./TendersFact") },
      { id: "dossier.wifi-mix", kind: "thing", order: 20, view: () => import("./WifiMix") },
    ],
    mapLayers: [
      {
        id: "dossier.remarkable",
        title: "Remarkable trees",
        group: "knowledge",
        swatch: MAP_INK.mint,
        minZoom: 13,
        attribution: "Trees: City of Brussels, Ville de Paris",
        description: "Trees that Brussels and Paris single out in their registers, with girth and crown where known. Shows nothing outside those two cities.",
        view: () => import("./RemarkableLayer"),
      },
      {
        id: "dossier.trees",
        title: "Street trees",
        group: "knowledge",
        swatch: MAP_INK.mint,
        minZoom: 16,
        attribution: "Trees: City of Brussels, Stad Gent, Ville de Paris, Comune di Bologna",
        description: "Every street tree in the city registers of Brussels, Ghent, Paris and Bologna, loaded for the area on screen. Shows nothing elsewhere.",
        view: () => import("./TreesLayer"),
      },
    ],
    nearby: [{ id: "dossier.trees", title: "Remarkable trees", order: 60, refreshMs: 3_600_000, attribution: "Trees: City of Brussels, Ville de Paris", load: () => import("./nearby") }],
    thingSources: [
      {
        id: "dossier.nasoni",
        title: "Rome nasoni",
        types: ["water"],
        order: 20,
        refreshMs: 6 * 3_600_000,
        attribution: "Nasoni: © OpenStreetMap contributors",
        load: () => import("./things-nasoni"),
      },
      {
        id: "dossier.wifi",
        title: "Roma Capitale hotspots",
        types: ["wifi"],
        order: 20,
        refreshMs: 6 * 3_600_000,
        attribution: "Wi-Fi: Roma Capitale open data (CC BY)",
        load: () => import("./things-wifi"),
      },
    ],
    tiles: [
      { id: "dossier.know", title: "Did you know", order: 40, view: () => import("./KnowTile") },
      { id: "dossier.buying", title: "What your city is buying", order: 41, view: () => import("./TendersTile") },
    ],
    commands: [
      {
        id: "dossier.nasone",
        title: "Nearest nasone",
        hint: "Rome's drinking fountain; opens it and shows a walking route",
        keywords: ["fountain", "water", "drink", "thirsty", "rome", "fontanella"],
        run: () => void import("./nearest").then((m) => m.findNearestNasone()),
      },
    ],
  },
});
