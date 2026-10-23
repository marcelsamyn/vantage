import { definePlugin } from "../../app/core/plugin";
import { MAP_INK } from "../city/extension";

export default definePlugin({
  id: "spacewx",
  name: "Space weather",
  description: "The Sun's mood and what it does to Earth: geomagnetic storms, solar wind, flares, the aurora oval, close asteroid approaches and fireballs, and the layers that shield us: cosmic rays, the magnetic field and the radio-reflecting ionosphere.",
  contributes: {
    mapLayers: [
      {
        id: "spacewx.aurora",
        title: "Aurora oval",
        group: "weather",
        description: "Where aurora is likely right now, as a probability field refreshed every ten minutes. It glows around the magnetic poles and swells in geomagnetic storms.",
        swatch: MAP_INK.mint,
        attribution: "Aurora: NOAA SWPC OVATION model",
        view: () => import("./AuroraLayer"),
      },
      {
        id: "spacewx.fireballs",
        title: "Fireballs",
        group: "knowledge",
        description: "Bright meteors recorded by U.S. government sensors since 1988, sized by impact energy. Only events the sensors reported appear, so it is a sample of the sky rather than a complete count.",
        swatch: MAP_INK.sodium,
        attribution: "Fireballs: NASA/JPL CNEOS",
        view: () => import("./FireballLayer"),
      },
    ],
    skyPanels: [
      { id: "spacewx.panel", title: "Space weather", order: 40, view: () => import("./SpacePanel") },
      { id: "spacewx.shields", title: "Earth's shields", order: 42, view: () => import("./ShieldsPanel") },
    ],
    profilers: { fireball: () => import("./FireballProfile") },
    nearby: [{ id: "spacewx.nearby", title: "Aurora", order: 75, refreshMs: 5 * 60_000, attribution: "Aurora: NOAA SWPC OVATION model", load: () => import("./nearby") }],
    services: [{ id: "spacewx.watcher", view: () => import("./Watcher") }],
    tiles: [{ id: "spacewx.aurora", title: "Aurora tonight", order: 66, view: () => import("./Tile") }],
  },
});
