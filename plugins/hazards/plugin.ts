import { definePlugin } from "../../app/core/plugin";
import { MAP_INK } from "../city/extension";

export default definePlugin({
  id: "hazards",
  name: "Hazards",
  description: "Earthquakes from USGS, EMSC and INGV, a live seismograph, disaster alerts from GDACS and natural events from NASA, on the map and in the feed.",
  contributes: {
    mapLayers: [
      {
        id: "hazards.quakes",
        title: "Earthquakes",
        group: "hazards",
        swatch: MAP_INK.alarm,
        defaultOn: true,
        attribution: "Earthquakes: USGS, EMSC, INGV",
        description: "Every M2.5+ earthquake of the past week worldwide (USGS), plus M1+ in Europe (EMSC) and every Italian event down to the smallest (INGV), duplicates removed. The past hour pulses.",
        view: () => import("./QuakeLayer"),
      },
      { id: "hazards.disasters", title: "Disaster alerts", group: "hazards", swatch: MAP_INK.sodium, attribution: "Alerts: GDACS", description: "Orange and red alerts from the UN/EU Global Disaster Alert and Coordination System.", view: () => import("./DisasterLayer") },
      {
        id: "hazards.eonet",
        title: "Natural events",
        group: "hazards",
        swatch: MAP_INK.alarm,
        attribution: "Events: NASA EONET",
        description: "Open wildfires, volcanoes, storms, icebergs, floods, dust and other events tracked by NASA, worldwide. Fires and volcanoes are red, other events amber, ice grey.",
        view: () => import("./EonetLayer"),
      },
    ],
    profilers: { quake: () => import("./QuakeProfile"), disaster: () => import("./DisasterProfile"), eonet: () => import("./EonetProfile") },
    nearby: [{ id: "hazards.nearby", title: "Earthquakes", order: 60, refreshMs: 2 * 60_000, attribution: "Earthquakes: USGS, EMSC, INGV", load: () => import("./nearby") }],
    services: [{ id: "hazards.watch", view: () => import("./Watcher") }],
    tiles: [{ id: "hazards.seismic", title: "Seismic activity", order: 40, view: () => import("./Tile") }],
  },
});
