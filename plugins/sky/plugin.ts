import { definePlugin } from "../../app/core/plugin";
import { glyph } from "./glyph";

export default definePlugin({
  id: "sky",
  name: "Sky",
  description: "A radar of everything above your horizon. Other plugins add targets through the skyLayers extension point and side panels through skyPanels.",
  contributes: {
    screen: {
      title: "Sky",
      summary: "Aircraft, satellites, Sun, Moon and stars above you",
      glyph,
      section: "world",
      order: 30,
      hotkey: "3",
      view: () => import("./SkyScreen"),
    },
  },
});
