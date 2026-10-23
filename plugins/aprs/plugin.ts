import { definePlugin } from "../../app/core/plugin";
import { MAP_INK } from "../city/extension";

export default definePlugin({
  id: "aprs",
  name: "APRS",
  description: "Live amateur radio stations, objects, weather and telemetry from APRS-IS.",
  contributes: {
    mapLayers: [{
      id: "aprs.live", title: "APRS radio stations", group: "live", swatch: MAP_INK.sodium,
      description: "Live APRS stations and objects with their reported positions and trails. Requires your callsign in VANTAGE_APRS_CALLSIGN.",
      attribution: "APRS-IS · APRS®", view: () => import("./AprsLayer"),
    }],
    profilers: { aprs: () => import("./AprsProfile") },
  },
});
