import { definePlugin } from "../../app/core/plugin";
import { MAP_INK } from "../city/extension";

/** EUMETSAT asks for the year the data was distributed. */
const YEAR = new Date().getFullYear();

export default definePlugin({
  id: "weather",
  name: "Weather",
  description: "Conditions, air quality and pollen from Open-Meteo, a live rain radar from RainViewer, official warnings from MeteoAlarm and Italy's Civil Protection, lightning and fires from Meteosat, Belgium's cloud base and soil from the RMI, and snow depth at Alpine stations from SLF.",
  contributes: {
    mapLayers: [
      { id: "weather.radar", title: "Rain radar", group: "weather", swatch: MAP_INK.ice, attribution: "Radar: RainViewer", description: "The last two hours of rain radar, looped so you can see which way showers move.", view: () => import("./RadarLayer") },
      {
        id: "weather.warnings",
        title: "Official warnings",
        group: "weather",
        swatch: MAP_INK.sodium,
        attribution: "Warnings: MeteoAlarm (EUMETNET), Dipartimento della Protezione Civile (CC BY 4.0), regions © EuroGeographics",
        description: "Yellow, orange and red weather warnings in force for Italy, Belgium and the country you are in, including Italy's civil-protection zones. A warning is drawn only where its issuer published an area outline.",
        view: () => import("./WarningsLayer"),
      },
      {
        id: "weather.lightning",
        title: "Lightning",
        group: "weather",
        swatch: MAP_INK.sodium,
        attribution: `Lightning: Meteosat Third Generation Lightning Imager, contains modified EUMETSAT Meteosat data ${YEAR}`,
        description: "Where lightning struck across Europe and North Africa in the last hour, in 5-minute steps, seen by a satellite. The newest frame is about 15 to 25 minutes old. Not a safety service.",
        view: () => import("./LightningLayer"),
      },
      {
        id: "weather.fires",
        title: "Fires (satellite)",
        group: "weather",
        swatch: MAP_INK.alarm,
        attribution: `Fires: Meteosat Third Generation fire radiative power, contains modified EUMETSAT Meteosat data ${YEAR}`,
        description: "Hot spots Meteosat sees from space, between 12°W and 40°E and 30°N and 62°N: wildfires, gas flares and volcanoes. Often only a handful at night.",
        view: () => import("./FiresLayer"),
      },
      {
        id: "weather.snow",
        title: "Snow stations",
        group: "weather",
        swatch: MAP_INK.bone,
        minZoom: 5,
        attribution: "Snow: WSL Institute for Snow and Avalanche Research SLF, IMIS network (CC BY 4.0)",
        description: "Snow depth at the SLF measuring stations in the Swiss Alps and Liechtenstein, updated every 30 minutes, with a glow where fresh snow has fallen. Shows nothing outside Switzerland and Liechtenstein.",
        view: () => import("./SnowLayer"),
      },
    ],
    profilers: { warning: () => import("./WarningProfile"), snowstation: () => import("./SnowProfile") },
    mapControls: [{ id: "weather.legends", title: "Weather legends", order: 10, view: () => import("./Legends") }],
    profilerSections: [{ id: "weather.belgium", kind: "place", order: 24, view: () => import("./BelgiumSection") }],
    tiles: [{ id: "weather.now", title: "Weather and air", span: 2, order: 5, view: () => import("./Tile") }],
    services: [{ id: "weather.watch", view: () => import("./Watcher") }],
    nearby: [{ id: "weather.nearby", title: "Weather warnings", order: 10, refreshMs: 10 * 60_000, attribution: "Warnings: MeteoAlarm (EUMETNET), Dipartimento della Protezione Civile (CC BY 4.0)", load: () => import("./nearby") },
      { id: "weather.fires.nearby", title: "Satellite fires", order: 70, refreshMs: 10 * 60_000, attribution: `Fires: Meteosat Third Generation, contains modified EUMETSAT Meteosat data ${YEAR}`, load: () => import("./nearby-fires") },
    ],
    commands: [
      { id: "weather.radar", title: "Show the rain radar", keywords: ["rain", "storm", "weather", "precipitation"], run: () => void import("../city/client").then((m) => m.showLayer("weather.radar")) },
      { id: "weather.lightning", title: "Show lightning over Europe", keywords: ["thunder", "storm", "flash", "lightning", "meteosat"], run: () => void import("../city/client").then((m) => m.showLayer("weather.lightning")) },
      { id: "weather.snow", title: "Show Alpine snow stations", keywords: ["snow", "alps", "ski", "slf", "switzerland", "neve"], run: () => void import("../city/client").then((m) => m.showLayer("weather.snow")) },
      { id: "weather.warnings", title: "Show official weather warnings", keywords: ["alert", "warning", "meteoalarm", "protezione civile", "storm", "allerta"], run: () => void import("../city/client").then((m) => m.showLayer("weather.warnings")) },
    ],
  },
});
