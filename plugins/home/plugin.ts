import { definePlugin } from "../../app/core/plugin";
import { glyph } from "./glyph";

export default definePlugin({
  id: "home",
  name: "Briefing",
  description: "Your surroundings at a glance, built from every plugin's live tiles. The viewer chooses which tiles to hide.",
  contributes: {
    screen: {
      title: "Briefing",
      summary: "Everything around you, at a glance",
      glyph,
      section: "here",
      order: 10,
      hotkey: "1",
      view: () => import("./Briefing"),
    },
    tiles: [
      { id: "home.here", title: "Here and now", span: 2, order: 0, view: () => import("./HereTile") },
      { id: "home.links", title: "Data links", span: 2, order: 90, view: () => import("./LinksTile") },
    ],
    commands: [
      {
        id: "home.customize",
        title: "Customize the briefing",
        hint: "Hide the tiles you do not need, or show them again",
        keywords: ["tiles", "hide", "show", "dashboard", "widgets", "home"],
        intent: { action: "customize" },
      },
    ],
  },
});
