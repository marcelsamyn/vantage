import { definePlugin } from "../../app/core/plugin";
import { glyph } from "./glyph";

export default definePlugin({
  id: "settings",
  name: "Settings",
  description: "Units, sounds and the settings every plugin declares, in one place.",
  contributes: {
    screen: {
      title: "Settings",
      summary: "Units, sounds and how each plugin draws",
      glyph,
      section: "tools",
      order: 90,
      hotkey: ",",
      view: () => import("./Screen"),
    },
  },
});
