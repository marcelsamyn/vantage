import { definePlugin } from "../../app/core/plugin";
import { glyph } from "./glyph";

export default definePlugin({
  id: "phone",
  name: "Phone",
  description: "Open VANTAGE on your phone through Tailscale: check the setup, share with one button, scan a QR code.",
  contributes: {
    screen: {
      title: "Phone",
      summary: "Open VANTAGE on your phone",
      glyph,
      section: "yours",
      order: 70,
      view: () => import("./Screen"),
    },
    commands: [
      {
        id: "phone.open",
        title: "Open VANTAGE on your phone",
        hint: "Phone",
        keywords: ["phone", "iphone", "mobile", "tailscale", "qr", "share", "remote", "home screen"],
        intent: { action: "open" },
      },
    ],
  },
});
