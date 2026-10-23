import { definePlugin } from "../../app/core/plugin";
import { glyph } from "./glyph";

export default definePlugin({
  id: "control",
  name: "Control",
  description: "Control this Mac and the devices you own: volume, keep awake, media, Shortcuts, Hue lights and printer supplies.",
  contributes: {
    screen: {
      title: "Control",
      summary: "Your Mac and the devices you own",
      glyph,
      section: "yours",
      order: 30,
      hotkey: "x",
      view: () => import("./Screen"),
    },
    tiles: [{ id: "control.tile", title: "Control", order: 35, view: () => import("./Tile") }],
    services: [{ id: "control.watch", view: () => import("./Watcher") }],
    commands: [
      { id: "control.awake", title: "Keep this Mac awake", hint: "Until you switch it off", keywords: ["caffeinate", "awake", "sleep", "coffee", "presentation"], intent: { action: "awake" } },
      { id: "control.sleep", title: "Sleep the display", keywords: ["display", "screen", "monitor", "off", "lock"], intent: { action: "sleep" } },
      { id: "control.shortcut", title: "Run a shortcut…", hint: "Asks before it runs", keywords: ["shortcuts", "homekit", "scene", "automation"], arg: { placeholder: "Shortcut name" }, intent: { action: "shortcut" } },
      { id: "control.pause", title: "Pause music", keywords: ["music", "spotify", "pause", "stop", "media", "quiet"], intent: { action: "pause" } },
      { id: "control.blackout", title: "Blackout", hint: "Pause media, turn off lights, sleep the display", keywords: ["lights", "off", "dark", "night", "leave"], intent: { action: "blackout" } },
    ],
  },
});
