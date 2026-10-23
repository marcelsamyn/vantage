import { definePlugin } from "../../app/core/plugin";
import { MAP_INK } from "../city/extension";
import { glyph } from "./glyph";

export default definePlugin({
  id: "wire",
  name: "Wire",
  description: "An x-ray of your Mac's own traffic: who it talks to, which ports it holds open, and the route a packet takes to any host.",
  contributes: {
    screen: {
      title: "Wire",
      summary: "Where your Mac's traffic goes",
      glyph,
      section: "yours",
      order: 20,
      hotkey: "w",
      view: () => import("./Screen"),
    },
    profilers: { host: () => import("./HostProfile") },
    mapLayers: [
      {
        id: "wire.connections",
        title: "Your connections",
        group: "network",
        description: "Arcs from you to every server your Mac is talking to right now. Locations are approximate, from GeoJS.",
        swatch: MAP_INK.sodium,
        attribution: "Locations: GeoJS",
        view: () => import("./ConnectionsLayer"),
      },
      {
        id: "wire.trace",
        title: "Last route trace",
        group: "network",
        description: "The path your packets took to the host you traced on the Wire screen, hop by hop.",
        swatch: MAP_INK.ice,
        attribution: "Locations: GeoJS",
        view: () => import("./TraceLayer"),
      },
    ],
    commands: [
      { id: "wire.connections", title: "Where is my Mac connecting?", keywords: ["connections", "traffic", "network", "servers", "who"], intent: { action: "connections" } },
      { id: "wire.trace", title: "Trace the route to…", keywords: ["traceroute", "route", "hops", "ping"], arg: { placeholder: "e.g. google.com" }, intent: { action: "trace" } },
      { id: "wire.ports", title: "Which ports are open on this Mac?", keywords: ["ports", "listening", "sharing", "exposed", "security"], intent: { action: "ports" } },
    ],
  },
});
