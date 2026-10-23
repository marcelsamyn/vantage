import { definePlugin } from "../../app/core/plugin";
import { MAP_INK } from "../city/extension";

export default definePlugin({
  id: "sensors",
  name: "Sensors",
  description: "Air, noise and radiation readings from volunteers' sensors and official stations, street by street.",
  contributes: {
    mapLayers: [
      {
        id: "sensors.air",
        title: "Air sensors",
        group: "live",
        swatch: MAP_INK.mint,
        minZoom: 9,
        attribution: "Air: Sensor.Community volunteers",
        description: "Dust (PM2.5) from volunteers' sensors on balconies and lamp posts, within about 25 km of the map centre. Mint is clean air, amber is above the WHO daily guideline, red is unhealthy.",
        view: () => import("./AirLayer"),
      },
      {
        id: "sensors.noise",
        title: "Noise sensors",
        group: "live",
        swatch: MAP_INK.mint,
        minZoom: 3,
        attribution: "Noise: Sensor.Community volunteers",
        description: "Sound level in dB(A) from volunteers' noise meters. Few exist: most are in the Netherlands and Germany, so zoom out to find them. Mint is quiet, amber a busy street, red loud.",
        view: () => import("./NoiseLayer"),
      },
      {
        id: "sensors.radiation",
        title: "Radiation",
        group: "live",
        swatch: MAP_INK.mint,
        minZoom: 3,
        attribution: "Radiation: BfS (Germany), Safecast",
        description: "Gamma dose rate in µSv/h. Filled dots are stations measuring now, from Germany's BfS network (nothing in other countries). Hollow dots are Safecast volunteers' survey walks from the past. Normal background is 0.05–0.2 µSv/h.",
        view: () => import("./RadiationLayer"),
      },
    ],
    nearby: [
      { id: "sensors.air", title: "Air quality", order: 60, refreshMs: 5 * 60_000, attribution: "Air: Sensor.Community volunteers", load: () => import("./nearby").then((m) => ({ default: m.sensorNearby("air") })) },
      { id: "sensors.noise", title: "Noise level", order: 70, refreshMs: 5 * 60_000, attribution: "Noise: Sensor.Community volunteers", load: () => import("./nearby").then((m) => ({ default: m.sensorNearby("noise") })) },
      { id: "sensors.radiation", title: "Radiation", order: 80, refreshMs: 5 * 60_000, attribution: "Radiation: BfS (Germany)", load: () => import("./nearby").then((m) => ({ default: m.sensorNearby("radiation") })) },
    ],
    profilers: { sensor: () => import("./SensorProfile") },
    services: [{ id: "sensors.watch", view: () => import("./Watcher") }],
    tiles: [{ id: "sensors.street", title: "Your street", order: 25, view: () => import("./Tile") }],
  },
});
