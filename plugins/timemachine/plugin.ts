import { definePlugin } from "../../app/core/plugin";

export default definePlugin({
  id: "timemachine",
  name: "Time machine",
  description: "Shows how the place on the City map looked decades or centuries ago, from open historical maps and aerial photographs.",
  contributes: {
    mapControls: [{ id: "timemachine.control", title: "Time machine", order: 20, view: () => import("./Control") }],
    tiles: [{ id: "timemachine.then-now", title: "Then and now", span: 2, order: 40, view: () => import("./Tile") }],
    nearby: [{ id: "timemachine.nearby", title: "Time machine", order: 60, refreshMs: 60 * 60_000, load: () => import("./nearby") }],
    commands: [
      {
        id: "timemachine.open",
        title: "Time machine",
        hint: "Maps and aerial photos of this place from the past",
        keywords: ["history", "historical", "old map", "ferraris", "aerial", "then and now", "past"],
        run: () => void import("./actions").then((m) => m.openTimeMachine()),
      },
      {
        id: "timemachine.oldest",
        title: "Show this place in the oldest map",
        hint: "Jumps to the earliest map or aerial photo of the City map's centre",
        keywords: ["oldest", "earliest", "ancient", "history", "first map"],
        run: () => void import("./actions").then((m) => m.showOldest()),
      },
    ],
  },
});
