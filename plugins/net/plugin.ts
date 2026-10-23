import { definePlugin } from "../../app/core/plugin";
import { glyph } from "./glyph";

export default definePlugin({
  id: "net",
  name: "Network",
  description: "Your Wi-Fi, the devices on your network and your connection speed.",
  contributes: {
    screen: {
      title: "Network",
      summary: "Your Wi-Fi, your devices, your connection",
      glyph,
      section: "yours",
      order: 10,
      hotkey: "7",
      view: () => import("./Screen"),
    },
    tiles: [{ id: "net.tile", title: "Network", order: 20, view: () => import("./Tile") }],
    status: [{ id: "net.status", order: 10, view: () => import("./Status") }],
    services: [{ id: "net.watch", view: () => import("./Watcher") }],
    profilers: { device: () => import("./DeviceProfile") },
    commands: [
      { id: "net.devices", title: "Who's on my Wi-Fi?", hint: "Network", keywords: ["devices", "network", "router", "lan", "connected"], intent: { action: "devices" } },
      { id: "net.speed", title: "Run speed test", hint: "Network", keywords: ["speed", "bandwidth", "download", "upload", "ping", "internet"], intent: { action: "speed" } },
      { id: "net.wifi", title: "Analyse Wi-Fi channels", hint: "Network", keywords: ["wifi", "wi-fi", "channel", "signal", "interference"], intent: { action: "wifi" } },
    ],
  },
});
