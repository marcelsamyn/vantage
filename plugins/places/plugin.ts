import { definePlugin } from "../../app/core/plugin";
import { MAP_INK } from "../city/extension";

export default definePlugin({
  id: "places",
  name: "Places",
  description: "Wikipedia articles about the places around you, on the map and in the Profiler.",
  contributes: {
    mapLayers: [
      {
        id: "places.wikipedia",
        title: "Wikipedia",
        group: "knowledge",
        description: "Articles about buildings, monuments and streets near the map centre, from Wikipedia.",
        swatch: MAP_INK.bone,
        defaultOn: true,
        minZoom: 12,
        attribution: "Places: Wikipedia (CC BY-SA)",
        view: () => import("./PlacesLayer"),
      },
    ],
    profilers: { article: () => import("./ArticleProfile") },
    nearby: [{ id: "places.nearby", title: "Landmarks", order: 10, refreshMs: 30 * 60_000, attribution: "Places: Wikipedia (CC BY-SA)", load: () => import("./nearby") }],
  },
});
