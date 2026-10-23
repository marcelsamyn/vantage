import { defineSettings } from "../../app/core/plugin";

export const settings = defineSettings("city", {
  terrain: {
    kind: "toggle",
    group: "Map",
    title: "3D terrain",
    description: "Hills and mountains rise from the map, and the far city fades into haze. Turn off if the map stutters on this device.",
    default: true,
  },
});
