import { definePlugin } from "../../app/core/plugin";
import { MAP_INK } from "../city/extension";
import { glyph } from "./glyph";

export default definePlugin({
  id: "drones", name: "Drones", description: "Drone Remote ID broadcasts received by your own nearby receiver.",
  contributes: {
    screen: { title: "Drones", summary: "Nearby Drone Remote ID broadcasts from your receiver.", glyph, section: "signals", order: 90, view: () => import("./DronesScreen") },
    mapLayers: [{ id: "drones.live", title: "Drones", group: "live", swatch: MAP_INK.sodium, attribution: "Drone Remote ID: your own receiver", description: "Recent drone positions from your Remote ID receiver: an Orecchino at orecchino.local, or the feed set in VANTAGE_DRONE_RECEIVER_URL. IDs without a recent GPS position appear in the Drones screen.", view: () => import("./DroneLayer") }],
    profilers: { drone: () => import("./DroneProfile") },
  },
});
