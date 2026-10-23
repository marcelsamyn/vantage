import { definePlugin } from "../../app/core/plugin";
import { MAP_INK } from "../city/extension";

export default definePlugin({
  id: "ships",
  name: "Ships",
  description: "Vessels broadcasting AIS positions, from Nordic feeds and an optional wider AIS Stream network.",
  contributes: {
    mapLayers: [
      {
        id: "ships.live",
        title: "Ships",
        group: "live",
        swatch: MAP_INK.sodium,
        minZoom: 4,
        attribution: "Ships: Fintraffic Digitraffic, Norwegian Coastal Administration (NLOD), AIS Stream",
        description:
          "Vessels broadcasting their position (AIS), turned to their heading with a short trail. Nordic feeds cover Finland, the Baltic and the Norwegian coast. Configure AIS Stream on the server for its receiver network in other areas; reception varies by place and vessel activity. Safety messages and search-and-rescue aircraft reports appear when received. Green passenger, amber cargo, white tanker, grey fishing and pleasure craft.",
        view: () => import("./ShipLayer"),
      },
    ],
    nearby: [{ id: "ships.live", title: "Ships", order: 70, refreshMs: 30_000, attribution: "Ships: Fintraffic Digitraffic, Norwegian Coastal Administration (NLOD), AIS Stream", load: () => import("./nearby") }],
    profilers: { ship: () => import("./ShipProfile") },
  },
});
