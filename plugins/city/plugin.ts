import { definePlugin } from "../../app/core/plugin";
import { glyph } from "./glyph";
import { settings } from "./settings";

export default definePlugin({
  id: "city",
  name: "City",
  description: "A live 3D map of where you are. Other plugins add layers to it through the mapLayers extension point.",
  contributes: {
    screen: {
      title: "City",
      summary: "Live open-data map of your surroundings",
      glyph,
      section: "world",
      order: 10,
      hotkey: "2",
      keepAlive: true,
      view: () => import("./CityScreen"),
    },
    profilers: {
      place: () => import("./PlaceProfile"),
      thing: () => import("./ThingProfile"),
    },
    mapLayerGroups: [
      { id: "live", title: "Live", order: 10 },
      { id: "hazards", title: "Hazards", order: 20 },
      { id: "weather", title: "Weather", order: 30 },
      { id: "street-grid", title: "Street grid", order: 40 },
      { id: "services", title: "Services", order: 50 },
      { id: "knowledge", title: "Knowledge", order: 60 },
      { id: "network", title: "Your network", order: 80 },
    ],
    settings: Object.values(settings),
    commands: [
      { id: "city.locate", title: "Show me on the map", keywords: ["where am i", "position"], intent: { action: "locate" } },
      { id: "city.around", title: "What's around me", hint: "Things to do and see within walking distance", keywords: ["nearby", "near me", "around", "walk", "what can i do"], intent: { action: "around" } },
      {
        id: "city.chicago",
        title: "Fly to Chicago, the city of Watch Dogs",
        keywords: ["watch dogs", "aiden", "loop", "ctos"],
        run: () => void import("./places").then((m) => m.flyTo(41.8826, -87.6233, 15.5)),
      },
      { id: "city.search", title: "Find a place on the map…", keywords: ["search", "fly", "go to"], arg: { placeholder: "e.g. Willis Tower" }, intent: { action: "search" } },
    ],
  },
});
