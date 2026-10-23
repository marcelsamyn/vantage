import { definePlugin } from "../../app/core/plugin";
import { glyph } from "./glyph";

export default definePlugin({
  id: "deepspace",
  name: "Deep space",
  description: "Who NASA's Deep Space Network is talking to right now: every dish in real pose, the signals running to Voyager and beyond, and where each spacecraft is in the Solar System.",
  contributes: {
    screen: {
      title: "Deep space",
      summary: "Who is talking to which spacecraft, right now",
      glyph,
      section: "world",
      order: 40,
      hotkey: "d",
      view: () => import("./Screen"),
    },
    tiles: [{ id: "deepspace.farthest", title: "Deep space", order: 70, view: () => import("./Tile") }],
    profilers: { spacecraft: () => import("./SpacecraftProfile") },
    services: [{ id: "deepspace.watcher", view: () => import("./Watcher") }],
    commands: [
      { id: "deepspace.dishes", title: "Deep Space Network: show the dishes", hint: "Every dish in Madrid, Goldstone and Canberra", keywords: ["dsn", "antenna", "radio", "madrid", "voyager"], intent: { action: "dishes" } },
      { id: "deepspace.orrery", title: "Deep Space Network: show the Solar System", hint: "Where every probe is, and who is listening", keywords: ["orrery", "planets", "probes", "voyager", "light time"], intent: { action: "orrery" } },
      {
        id: "deepspace.spacecraft",
        title: "Find a spacecraft",
        hint: "Voyager 1, Juno, New Horizons, Webb…",
        keywords: ["probe", "voyager", "webb", "juno", "parker", "profile"],
        arg: { placeholder: "Spacecraft name" },
        intent: { action: "spacecraft" },
      },
    ],
  },
});
