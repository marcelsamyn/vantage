import { definePlugin } from "../../app/core/plugin";

export default definePlugin({
  id: "astro",
  name: "Astronomy",
  description: "The Sun, the Moon and the brightest stars, computed on this Mac for where you stand.",
  contributes: {
    skyLayers: [
      {
        id: "astro.sunmoon",
        title: "Sun and Moon",
        description: "Where the Sun and the Moon are now, and their paths across today's sky.",
        swatch: "var(--sodium)",
        defaultOn: true,
        view: () => import("./AstroSky"),
      },
      {
        id: "astro.stars",
        title: "Bright stars",
        description: "The 60 brightest stars above your horizon, from the Yale Bright Star Catalogue.",
        swatch: "var(--bone)",
        defaultOn: true,
        view: () => import("./StarsSky"),
      },
    ],
    profilers: { body: () => import("./BodyProfile") },
    tiles: [{ id: "astro.sunmoon", title: "Sun and Moon", order: 10, view: () => import("./Tile") }],
  },
});
