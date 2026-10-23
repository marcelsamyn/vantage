import { definePlugin } from "../../app/core/plugin";
import { MAP_INK } from "../city/extension";
import { glyph } from "./glyph";

export default definePlugin({
  id: "webcams",
  name: "Cameras",
  description: "Cameras worldwide: road cameras and public webcams around you, volcanoes, ocean buoys and polar stations, and pictures of Earth and the Sun from space.",
  contributes: {
    screen: {
      title: "Cameras",
      summary: "Look through cameras worldwide",
      glyph,
      section: "world",
      order: 20,
      hotkey: "c",
      view: () => import("./Screen"),
    },
    commands: [
      { id: "webcams.near", title: "Show cameras near me", hint: "Cameras", keywords: ["webcam", "traffic", "cctv", "wall", "live"], intent: { action: "near" } },
      { id: "webcams.random", title: "Look through a random camera", hint: "Cameras", keywords: ["webcam", "jump", "shuffle", "surprise", "cctv"], intent: { action: "random" } },
      { id: "webcams.remote", title: "Show remote cameras", hint: "Cameras", keywords: ["volcano", "antarctica", "ocean", "buoy", "aurora", "observatory", "webcam"], intent: { action: "remote" } },
      { id: "webcams.orbit", title: "Show the Earth from space", hint: "Cameras", keywords: ["satellite", "goes", "himawari", "sun", "sdo", "soho", "epic", "orbit"], intent: { action: "orbit" } },
    ],
    mapLayers: [
      {
        id: "webcams.traffic",
        title: "Street cameras and webcams",
        group: "street-grid",
        swatch: MAP_INK.ice,
        minZoom: 9,
        attribution: "Cameras: TfL, Caltrans, LTA, HK TD, Fintraffic, NZTA, DriveBC, Toronto, Calgary, ODOT, CDOT, Vegagerðin, A22, Madrid, SCT · Webcams provided by Windy.com · OpenStreetMap contributors",
        description: "Cameras you can look through. Road cameras come from their operators in London, California, Singapore, Hong Kong, Finland, New Zealand, British Columbia, Toronto, Calgary, Oregon, Colorado, Iceland, the Brenner motorway, Madrid and Catalonia. Webcams worldwide come from Windy.com (with a free key, see README) and from OpenStreetMap. Zoom in to see each camera's latest picture.",
        view: () => import("./CameraLayer"),
      },
      {
        id: "webcams.remote",
        title: "Remote cameras",
        group: "knowledge",
        swatch: MAP_INK.sodium,
        attribution: "Cameras: USGS, NOAA NDBC, Australian Antarctic Division, IRF, SGO, IAC",
        description: "Cameras in places few people go: volcanoes in Hawaii, Alaska and the Cascades, ocean buoys, Antarctic stations and aurora and observatory cameras. More than a hundred worldwide.",
        view: () => import("./RemoteLayer"),
      },
    ],
    nearbyMapLayers: [{ source: "webcams.nearby", view: () => import("./NearbyCameraLayer") }],
    profilers: { webcam: () => import("./WebcamProfile") },
    profilerSections: [{ id: "webcams.public-picture", kind: "grid", order: 10, view: () => import("./PublicPicture") }],
    nearby: [{ id: "webcams.nearby", title: "Live cameras", order: 40, refreshMs: 5 * 60_000, attribution: "Cameras: their operators, named on each card", load: () => import("./nearby") }],
  },
});
