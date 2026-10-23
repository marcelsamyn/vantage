import { definePlugin } from "../../app/core/plugin";
import { MAP_INK } from "../city/extension";

export default definePlugin({
  id: "gnss",
  name: "Navigation satellites",
  description: "Where GPS signals are being jammed, from aircraft reports, and the health of the Galileo satellites.",
  contributes: {
    mapLayers: [
      {
        id: "gnss.jamming",
        title: "GPS interference",
        group: "hazards",
        swatch: MAP_INK.alarm,
        attribution: "GPS interference: gpsjam.org, from airplanes.live and ADS-B Exchange reports",
        description:
          "Jamming is a transmitter that drowns out the faint satellite signal, so receivers lose their position. Aircraft report how good their navigation is, and this map shows the share that reported poor accuracy during the last full day. It clusters near conflicts because armed forces use jammers there. It shows nothing where no aircraft flew.",
        view: () => import("./JamLayer"),
      },
    ],
    nearby: [{ id: "gnss.nearby", title: "GPS interference", order: 80, refreshMs: 3_600_000, attribution: "GPS interference: gpsjam.org, from airplanes.live and ADS-B Exchange reports", load: () => import("./nearby") }],
    skyPanels: [{ id: "gnss.galileo", title: "Navigation satellites", order: 30, view: () => import("./GalileoPanel") }],
    commands: [{ id: "gnss.jamming", title: "Show GPS interference", keywords: ["gps", "jamming", "spoofing", "gnss", "interference"], run: () => void import("../city/client").then((m) => m.showLayer("gnss.jamming")) }],
  },
});
