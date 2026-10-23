import { definePlugin } from "../../app/core/plugin";
import { MAP_INK } from "../city/extension";

export default definePlugin({
  id: "sea",
  name: "Sea",
  description: "Sea level every minute at tide gauges, with a flag when the water swings far more than usual, and the robots that drift and dive through the ocean.",
  contributes: {
    mapLayers: [
      {
        id: "sea.level",
        title: "Sea level",
        group: "hazards",
        swatch: MAP_INK.sodium,
        defaultOn: true,
        minZoom: 3,
        attribution: "Sea level: VLIZ and UNESCO/IOC (unchecked data)",
        description:
          "Tide gauges that report the height of the sea every minute or every few minutes, from the IOC's monitoring network. A gauge turns red when its water swings far more than it usually does. That can be a seiche or a meteotsunami; it is not a tsunami warning. Dense along the coasts of Italy, Belgium and the Netherlands.",
        view: () => import("./GaugeLayer"),
      },
      {
        id: "sea.argo",
        title: "Ocean robots",
        group: "knowledge",
        swatch: MAP_INK.bone,
        minZoom: 4,
        attribution: "Floats: International Argo Program, Euro-Argo (Ifremer)",
        description:
          "Argo floats: robots that drift with the current, dive to 2,000 m every ten days or so and measure temperature and salt on the way up. Shows floats whose last dive was in the past three weeks, in the area you are looking at.",
        view: () => import("./ArgoLayer"),
      },
    ],
    profilers: { tidegauge: () => import("./GaugeProfile"), argo: () => import("./ArgoProfile") },
    services: [{ id: "sea.watch", view: () => import("./Watcher") }],
  },
});
