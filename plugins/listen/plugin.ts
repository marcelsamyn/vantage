import { definePlugin } from "../../app/core/plugin";
import { MAP_INK } from "../city/extension";
import { glyph } from "./glyph";

export default definePlugin({
  id: "listen",
  name: "Listen",
  description: "Live microphones around the world, birds singing near you, and the meteors that crossed the sky last night.",
  contributes: {
    screen: {
      title: "Listen",
      summary: "Live microphones, birdsong and meteors",
      glyph,
      section: "signals",
      order: 40,
      hotkey: "l",
      view: () => import("./Screen"),
    },
    tiles: [{ id: "listen.tile", title: "Listen", order: 25, view: () => import("./Tile") }],
    status: [{ id: "listen.mini", order: -9, view: () => import("./Status") }],
    mapLayers: [
      {
        id: "listen.meteors",
        title: "Meteors last night",
        group: "knowledge",
        description: "A short streak for each meteor, from where it lit up to where it burned out, coloured by height. Cameras of the Global Meteor Network cover Europe, North America, Japan, Australia and New Zealand well and most other places barely. Zoom out to see them.",
        swatch: MAP_INK.sodium,
        attribution: "Meteors: Global Meteor Network (CC BY 4.0)",
        view: () => import("./MeteorLayer"),
      },
    ],
    profilers: { meteor: () => import("./MeteorProfile") },
    nearby: [{ id: "listen.nearby", title: "Live microphones", order: 50, refreshMs: 10 * 60_000, attribution: "Sound: Locus Sonus, Orcasound", load: () => import("./nearby") }],
    commands: [
      {
        id: "listen.nearest",
        title: "Listen to the nearest microphone",
        hint: "Plays the live microphone closest to you",
        keywords: ["listen", "microphone", "sound", "audio", "ambient", "hydrophone"],
        intent: { action: "nearest" },
      },
      {
        id: "listen.meteors",
        title: "Show last night's meteors on the map",
        keywords: ["meteor", "shooting star", "fireball", "shower", "sky"],
        run: () => void import("./client").then((m) => m.showMeteors()),
      },
    ],
  },
});
