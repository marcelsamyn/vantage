import { definePlugin } from "../../app/core/plugin";
import { MAP_INK } from "../city/extension";

export default definePlugin({
  id: "sondes",
  name: "Weather balloons",
  description: "Radiosondes in flight, heard live by volunteers with software radios: on the map, on the sky radar, and in the feed when one lands near you.",
  contributes: {
    mapLayers: [
      {
        id: "sondes.live",
        title: "Weather balloons",
        group: "live",
        description: "Radiosondes heard in the past two hours, with predicted path, burst point and landing zone. Launched twice a day from about 800 sites; most are over Europe, North America and East Asia.",
        swatch: MAP_INK.sodium,
        attribution: "Radiosondes: SondeHub volunteers",
        view: () => import("./SondesLayer"),
      },
      {
        id: "sondes.amateur",
        title: "Amateur balloons",
        group: "live",
        description: "Small balloons that radio amateurs launch to drift around the world for weeks or months, with the path of the past three days. Positions come from volunteers' receivers, so remote oceans are patchy.",
        swatch: MAP_INK.sodium,
        defaultOn: false,
        attribution: "Amateur balloons: SondeHub volunteers",
        view: () => import("./BalloonsLayer"),
      },
    ],
    skyLayers: [
      {
        id: "sondes.sky",
        title: "Weather balloons",
        description: "Radiosondes above your horizon, up to 35 km high and several hundred km away.",
        swatch: "var(--sodium)",
        defaultOn: true,
        view: () => import("./SondesSky"),
      },
    ],
    nearby: [
      { id: "sondes.live", title: "Weather balloons", order: 80, refreshMs: 30_000, attribution: "Radiosondes: SondeHub volunteers", load: () => import("./nearby").then((m) => ({ default: m.sondeNearby })) },
      { id: "sondes.amateur", title: "Amateur balloons", order: 90, refreshMs: 10 * 60_000, attribution: "Amateur balloons: SondeHub volunteers", load: () => import("./nearby").then((m) => ({ default: m.balloonNearby })) },
    ],
    profilers: { sonde: () => import("./SondeProfile"), amateurballoon: () => import("./BalloonProfile") },
    services: [{ id: "sondes.watcher", view: () => import("./Watcher") }],
    tiles: [{ id: "sondes.nearest", title: "Weather balloons", order: 65, view: () => import("./Tile") }],
  },
});
