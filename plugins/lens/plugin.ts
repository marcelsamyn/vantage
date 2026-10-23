import { definePlugin } from "../../app/core/plugin";
import { glyph } from "./glyph";

export default definePlugin({
  id: "lens",
  name: "ctOS Lens",
  description: "Point your phone at nearby landmarks, stops and cameras, then tap to open their profiles.",
  contributes: {
    screen: { title: "Lens", summary: "Point your phone at the city", glyph, section: "here", order: 20, view: () => import("./Screen") },
    commands: [{ id: "lens.open", title: "Open ctOS Lens", keywords: ["ar", "camera", "profiler", "point", "street"], intent: { action: "open" } }],
  },
});
