import { definePlugin } from "../../app/core/plugin";
import { MAP_INK } from "../city/extension";

export default definePlugin({
  id: "satellites",
  name: "Satellites",
  description: "Satellites and space stations from CelesTrak orbital elements, positioned on this Mac with the SGP4 model.",
  contributes: {
    mapLayers: [
      {
        id: "satellites.stations",
        title: "Space stations",
        group: "live",
        description: "The ISS and Tiangong right now, their ground tracks, and the area from which each is above the horizon.",
        swatch: MAP_INK.ice,
        defaultOn: true,
        attribution: "Orbits: CelesTrak",
        view: () => import("./StationsLayer"),
      },
    ],
    skyLayers: [
      { id: "satellites.stations", title: "Space stations", description: "The ISS and Tiangong with their paths across your sky.", swatch: "var(--ice)", defaultOn: true, view: () => import("./StationsSky") },
      { id: "satellites.visual", title: "Bright satellites", description: "About 150 satellites you can see with the naked eye when they are sunlit.", swatch: "var(--ice)", defaultOn: true, view: () => import("./VisualSky") },
      { id: "satellites.gps", title: "GPS satellites", description: "The navigation satellites your phone uses to find its position.", swatch: "var(--mint)", view: () => import("./GpsSky") },
      { id: "satellites.starlink", title: "Starlink", description: "Every Starlink satellite above you: thousands of them. Heavy: updates every 5 seconds.", swatch: "var(--ice)", view: () => import("./StarlinkSky") },
    ],
    skyPanels: [{ id: "satellites.passes", title: "Space station passes", order: 10, view: () => import("./PassesPanel") }],
    profilers: { satellite: () => import("./SatProfile") },
    services: [{ id: "satellites.passes", view: () => import("./PassWatcher") }],
    nearby: [{ id: "satellites.nearby", title: "Space station passes", order: 30, refreshMs: 10 * 60_000, attribution: "Orbits: CelesTrak", load: () => import("./nearby") }],
    tiles: [{ id: "satellites.next", title: "Space station overhead", order: 30, view: () => import("./Tile") }],
  },
});
