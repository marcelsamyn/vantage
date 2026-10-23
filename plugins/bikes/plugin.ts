import { definePlugin } from "../../app/core/plugin";
import { MAP_INK } from "../city/extension";

export default definePlugin({
  id: "bikes",
  name: "Bike share",
  description: "Live availability of bike-share stations worldwide (CityBikes) and of scooters and free-floating bikes (operators' GBFS feeds).",
  contributes: {
    mapLayers: [
      { id: "bikes.stations", title: "Bike share", group: "live", swatch: MAP_INK.mint, defaultOn: true, minZoom: 13, attribution: "Bikes: CityBikes", description: "Bike-share stations within 30 km of the map centre, with live counts: mint has bikes, sodium is nearly empty, alarm is empty. Shows 0 where no network is listed in CityBikes.", view: () => import("./BikeLayer") },
    ],
    thingTypes: [
      {
        id: "scooter",
        minZoom: 15,
        title: "Scooters and free-floating bikes",
        group: "live",
        tone: "mint",
        order: 60,
        nearby: "go",
        description: "Scooters, mopeds and bikes you can unlock where they stand, from the operators who publish open GBFS feeds in your country. The ring is the battery: mint above 40 %, amber 15–40 %, red below.",
        icon: () => import("lucide-react").then((m) => m.Scooter),
        variants: {
          bike: () => import("lucide-react").then((m) => m.Bike),
          scooter: () => import("lucide-react").then((m) => m.Scooter),
          moped: () => import("lucide-react").then((m) => m.Motorbike),
          car: () => import("lucide-react").then((m) => m.Car),
        },
      },
    ],
    thingSources: [
      {
        id: "bikes.gbfs",
        title: "Operators' GBFS feeds",
        types: ["scooter"],
        minZoom: 12,
        refreshMs: 60_000,
        attribution: "Scooters: operators' GBFS feeds via MobilityData",
        load: () => import("./things"),
      },
    ],
    profilerSections: [{ id: "bikes.pricing", kind: "thing", order: 10, view: () => import("./Pricing") }],
    profilers: { bikestation: () => import("./StationProfile") },
    nearby: [{ id: "bikes.nearby", title: "Bike share", order: 20, attribution: "Bikes: CityBikes", load: () => import("./nearby") }],
    commands: [{ id: "bikes.find", title: "Find a bike nearby", keywords: ["bicycle", "cycle", "share", "ride"], run: () => void import("./nearest").then((m) => m.findBike()) }],
  },
});
