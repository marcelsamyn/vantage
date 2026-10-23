import { definePlugin } from "../../app/core/plugin";
import { glyph } from "./glyph";

export default definePlugin({
  id: "scan",
  name: "Scan",
  description: "Object detection, QR safety checks and motion sentry for your own camera, analysed on this Mac.",
  contributes: {
    screen: {
      title: "Scan",
      summary: "Camera vision, QR safety check and motion sentry",
      glyph,
      section: "signals",
      order: 10,
      hotkey: "4",
      view: () => import("./Screen"),
    },
    tiles: [{ id: "scan.tile", title: "Scan", view: () => import("./Tile") }],
    commands: [
      { id: "scan.qr", title: "Scan a QR code", hint: "Scan", keywords: ["qr", "barcode", "link", "wifi", "camera"], intent: { action: "qr" } },
      { id: "scan.sentry", title: "Arm motion sentry", hint: "Scan", keywords: ["motion", "watch", "camera", "alarm", "security"], intent: { action: "sentry" } },
      { id: "scan.vision", title: "Detect objects with the camera", hint: "Scan", keywords: ["objects", "vision", "detect", "camera", "ai"], intent: { action: "vision" } },
    ],
  },
});
