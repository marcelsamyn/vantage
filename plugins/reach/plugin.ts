import { definePlugin } from "../../app/core/plugin";
import { MAP_INK } from "../city/extension";
import { glyph } from "./glyph";

export default definePlugin({
  id: "reach",
  name: "Reach",
  description: "Things in the outside world you can use: radio receivers, satellite ground stations, reports to your city and notes on the world map.",
  contributes: {
    screen: {
      title: "Reach",
      summary: "Things in the world you can operate",
      glyph,
      section: "world",
      order: 50,
      hotkey: "r",
      view: () => import("./ReachScreen"),
    },
    tiles: [{ id: "reach.tile", title: "Within reach", order: 25, view: () => import("./Tile") }],
    mapLayerGroups: [{ id: "reach", title: "Reach", order: 70 }],
    mapLayers: [
      {
        id: "reach.receivers",
        title: "Radio receivers",
        group: "reach",
        swatch: MAP_INK.sodium,
        attribution: "Receivers: KiwiSDR.com",
        description: "KiwiSDR radio receivers you can tune from here. Brighter dots have more listeners. Worldwide, mostly Europe and North America.",
        view: () => import("./ReceiverLayer"),
      },
      {
        id: "reach.stations",
        title: "Satellite ground stations",
        group: "reach",
        swatch: MAP_INK.mint,
        attribution: "Stations: SatNOGS Network (CC BY-SA)",
        description: "Volunteer ground stations on the SatNOGS Network that record satellite passes you can listen to. A ringed dot is recording right now.",
        view: () => import("./StationLayer"),
      },
      {
        id: "reach.orders",
        title: "City work orders",
        group: "reach",
        swatch: MAP_INK.bone,
        minZoom: 11,
        attribution: "Reports: SeeClickFix, FixMyStreet, Boston 311",
        description: "Open reports of potholes, broken streetlights and the like, from SeeClickFix (US cities), FixMyStreet (UK, Sweden, Zürich) and Boston 311. Shows nothing where none of them is used.",
        view: () => import("./OrderLayer"),
      },
      {
        id: "reach.notes",
        title: "Map notes",
        group: "reach",
        swatch: MAP_INK.fog,
        minZoom: 15,
        attribution: "Notes: OpenStreetMap contributors (ODbL)",
        description: "Notes that people left on the OpenStreetMap world map: open ones, and ones closed in the last week.",
        view: () => import("./NoteLayer"),
      },
    ],
    nearby: [
      { id: "reach.receivers", title: "Radio receivers", order: 60, refreshMs: 10 * 60_000, attribution: "Receivers: KiwiSDR.com", load: () => import("./nearby").then((m) => ({ default: m.receiverNearby })) },
      { id: "reach.notes", title: "Map notes", order: 70, refreshMs: 5 * 60_000, attribution: "Notes: OpenStreetMap contributors (ODbL)", load: () => import("./nearby").then((m) => ({ default: m.noteNearby })) },
      { id: "reach.stations", title: "Satellite ground stations", order: 80, refreshMs: 2 * 60_000, attribution: "Stations: SatNOGS Network (CC BY-SA)", load: () => import("./nearby").then((m) => ({ default: m.stationNearby })) },
      { id: "reach.orders", title: "City work orders", order: 90, refreshMs: 5 * 60_000, attribution: "Reports: SeeClickFix, FixMyStreet, Boston 311", load: () => import("./nearby").then((m) => ({ default: m.orderNearby })) },
    ],
    profilers: {
      receiver: () => import("./ReceiverProfile"),
      groundstation: () => import("./StationProfile"),
      workorder: () => import("./OrderProfile"),
      mapnote: () => import("./NoteProfile"),
    },
    commands: [
      { id: "reach.tune", title: "Tune a radio somewhere else", hint: "Pick a free receiver far from you", keywords: ["radio", "kiwisdr", "shortwave", "listen", "receiver", "websdr"], intent: { action: "tune" } },
      { id: "reach.listen", title: "Listen through a satellite ground station", hint: "Hear the latest pass recorded near you", keywords: ["satnogs", "satellite", "ground station", "pass", "audio"], intent: { action: "listen" } },
      { id: "reach.orders", title: "Show the city's open work orders", hint: "Potholes, streetlights, graffiti near you", keywords: ["311", "pothole", "report", "city", "seeclickfix", "fixmystreet"], intent: { action: "orders" } },
      { id: "reach.note", title: "Leave a map note here", hint: "Public note on OpenStreetMap, after you confirm", keywords: ["osm", "openstreetmap", "note", "camera", "map"], intent: { action: "note" } },
    ],
  },
});
