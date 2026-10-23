import { definePlugin } from "../../app/core/plugin";
import { MAP_INK } from "../city/extension";

export default definePlugin({
  id: "transit",
  name: "Transit",
  description: "Live public transport: vehicles, departures and service alerts worldwide from Transitous, live STIB predictions and vehicles in Brussels, Rome vehicle positions and crowding, every Italian and Belgian train, GPS feeds in the Netherlands, Spain, Norway, Wallonia and around Lisbon, and Belgian rail works and level crossings.",
  contributes: {
    mapLayers: [
      {
        id: "transit.vehicles",
        title: "Public transport",
        group: "live",
        swatch: MAP_INK.ice,
        defaultOn: true,
        minZoom: 12,
        attribution: "Transit: Transitous · Rome positions and seats: ATAC, Roma Mobilità · GPS: OVapi, Renfe, Entur, Carris Metropolitana, STIB and TEC (Belgian Mobility, CC BY 4.0)",
        description:
          "Buses, trams, metros and trains moving along their routes, from live and scheduled data. Zoom in to see an icon for each kind. A red ring means 5 minutes late or more, an amber ring 1 to 4. GPS fixes anchor movement along matched routes for up to two minutes; the profile shows the age of the measurement. In Rome, vehicles use reported GPS positions and a small bar shows how full they are. In the Netherlands, Spain, Norway, Brussels, Wallonia and around Lisbon, vehicles that Transitous cannot place are drawn at their reported position.",
        view: () => import("./VehicleLayer"),
      },
      { id: "transit.stops", title: "Transit stops", group: "live", swatch: MAP_INK.ice, minZoom: 13.5, attribution: "Transit: Transitous", description: "Square signs are stops; larger cyan signs mark metro and rail stations. Click one for its live departures board, with service alerts in Rome and live Italian and Belgian trains.", view: () => import("./StopLayer") },
      {
        id: "transit.works",
        title: "Rail works",
        group: "live",
        swatch: MAP_INK.sodium,
        attribution: "Rail works: Infrabel open data (CC0)",
        description: "Track that Infrabel plans to close or slow down in the next four months: red for a major impact, amber for a minor one, dashed when it starts later. Shows Belgium only.",
        view: () => import("./RailWorksLayer"),
      },
      {
        id: "transit.crossings",
        title: "Level crossings",
        group: "street-grid",
        swatch: MAP_INK.fog,
        minZoom: 13,
        attribution: "Level crossings: Infrabel open data (CC0)",
        description: "Every level crossing on the Belgian rail network. Grey rings have barriers, amber rings only lights, and red rings only a sign. Shows Belgium only.",
        view: () => import("./CrossingsLayer"),
      },
    ],
    profilers: {
      vehicle: () => import("./VehicleProfile"),
      stop: () => import("./StopProfile"),
      train: () => import("./TrainProfile"),
      trip: () => import("./TripProfile"),
      railwork: () => import("./RailProfile"),
      crossing: () => import("./CrossingProfile"),
    },
    profilerSections: [{ id: "transit.works", kind: "stop", order: 40, view: () => import("./StationWorks") }],
    nearby: [
      { id: "transit.nearby", title: "Stop departures", order: 10, refreshMs: 30_000, attribution: "Transit: Transitous · STIB (Belgian Mobility, CC BY 4.0)", load: () => import("./nearby") },
      { id: "transit.vehicles", title: "Live vehicles", order: 11, refreshMs: 10_000, attribution: "Transit GPS: ATAC, Roma Mobilità, OVapi, Renfe, Entur, Carris Metropolitana, STIB and TEC (Belgian Mobility, CC BY 4.0)", load: () => import("./nearby").then((m) => ({ default: m.nearbyVehicles })) },
      { id: "transit.works", title: "Rail works", order: 60, refreshMs: 600_000, attribution: "Rail works: Infrabel open data (CC0)", load: () => import("./nearby-works") },
    ],
    commands: [
      {
        id: "transit.train",
        title: "Where is train …",
        hint: "Italian or Belgian train, by number",
        keywords: ["train", "treno", "trein", "trenitalia", "viaggiatreno", "sncb", "nmbs", "irail", "intercity", "regionale"],
        arg: { placeholder: "Train number: 4694, or IC 1832 for Belgium" },
        run: (arg) => void import("./findTrain").then((m) => m.findTrain(arg ?? "")),
      },
    ],
    services: [{ id: "transit.alerts", view: () => import("./Watcher") }],
    tiles: [{ id: "transit.around", title: "Transit around you", order: 31, view: () => import("./Tile") }],
  },
});
