import { definePlugin } from "../../app/core/plugin";
import { MAP_INK } from "../city/extension";

export default definePlugin({
  id: "aircraft",
  name: "Aircraft",
  description: "Live aircraft from ADS-B receivers: on the map, on the sky radar, and in the feed.",
  contributes: {
    mapLayers: [
      {
        id: "aircraft.live",
        title: "Aircraft",
        group: "live",
        description: "Every aircraft broadcasting its position near the map view, moved smoothly between updates. Colour shows altitude: green near the ground, amber at mid levels, white at cruise. Tilt the map to see them fly at their altitude. Data from adsb.lol receivers.",
        swatch: MAP_INK.sodium,
        defaultOn: true,
        attribution: "ADS-B: adsb.lol (ODbL)",
        view: () => import("./AircraftLayer"),
      },
      {
        id: "aircraft.emergencies",
        title: "Emergencies",
        group: "live",
        description: "Every aircraft in the world that squawks 7700 (emergency), 7600 (radio failure) or 7500 (hijack code, often a pilot mistake). Usually it shows nothing or a few flights. Heard by volunteer ADS-B receivers (adsb.lol, adsb.fi).",
        swatch: MAP_INK.alarm,
        defaultOn: true,
        attribution: "ADS-B: adsb.lol, adsb.fi",
        view: () => import("./EmergenciesLayer"),
      },
      {
        id: "aircraft.circling",
        title: "Circling aircraft",
        group: "live",
        description: "Aircraft within 60 km of you that fly round in circles over one spot, drawn as a glowing loop. Looks only at flights VANTAGE saw since you opened it.",
        swatch: MAP_INK.sodium,
        defaultOn: true,
        attribution: "ADS-B: adsb.lol, adsb.fi",
        view: () => import("./CirclingLayer"),
      },
      {
        id: "aircraft.military",
        title: "Military aircraft",
        group: "live",
        description: "Military aircraft anywhere in the world whose transponders are on. Many fly with them off, and some countries hide theirs from public networks, so this is only part of the picture.",
        swatch: MAP_INK.bone,
        attribution: "ADS-B: adsb.lol, adsb.fi",
        view: () => import("./MilitaryLayer"),
      },
    ],
    skyLayers: [
      {
        id: "aircraft.sky",
        title: "Aircraft",
        description: "Aircraft above your horizon within 40 nautical miles.",
        swatch: "var(--sodium)",
        defaultOn: true,
        view: () => import("./AircraftSky"),
      },
    ],
    profilers: { aircraft: () => import("./AircraftProfile") },
    services: [{ id: "aircraft.watcher", view: () => import("./Watcher") }],
    nearby: [{ id: "aircraft.nearby", title: "Aircraft overhead", order: 20, refreshMs: 15_000, attribution: "ADS-B: adsb.lol, adsb.fi", load: () => import("./nearby") }],
    tiles: [{ id: "aircraft.traffic", title: "Air traffic around you", order: 20, view: () => import("./Tile") }],
  },
});
