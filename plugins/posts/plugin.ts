import { definePlugin } from "../../app/core/plugin";
import { MAP_INK } from "../city/extension";

export default definePlugin({
  id: "posts",
  name: "Posts",
  description: "Recent geotagged posts on the City map: nature sightings, Brussels street reports and, with optional keys, live video and photos. Each post shows its photo, its author and what its source says about it.",
  contributes: {
    mapLayerGroups: [{ id: "posts", title: "Posts", order: 65 }],
    mapLayers: [
      {
        id: "posts.sightings",
        title: "Nature sightings",
        group: "posts",
        swatch: MAP_INK.mint,
        minZoom: 8,
        attribution: "Sightings: iNaturalist · photo licences on each card",
        description:
          "Plants, birds, insects and other living things that people photographed and posted to iNaturalist in the last 24 hours. The newest are brightest; zoom in to see the photos. A dashed circle marks a sighting whose exact spot is hidden. Worldwide.",
        view: () => import("./SightingsLayer"),
      },
      {
        id: "posts.reports",
        title: "Street reports",
        group: "posts",
        swatch: MAP_INK.sodium,
        minZoom: 12,
        attribution: "Reports: Fix My Street Brussels, Brussels Mobility (CC0)",
        description:
          "Litter, potholes, broken lights and other problems reported to Fix My Street in the last 7 days. Shapes show the kind of problem; colour shows new, in progress or closed. Covers the Brussels region only. The source gives the day, not the time.",
        view: () => import("./ReportsLayer"),
      },
      {
        id: "posts.live",
        title: "Live video",
        group: "posts",
        swatch: MAP_INK.sodium,
        minZoom: 6,
        attribution: "Live video: YouTube",
        description:
          "YouTube streams that are live now and give the place they film. Hover to see how many people watch; click to play. Worldwide, for streams that set a location. Needs a free YouTube API key: see README.",
        view: () => import("./LiveLayer"),
      },
      {
        id: "posts.photos",
        title: "Photos",
        group: "posts",
        swatch: MAP_INK.bone,
        minZoom: 9,
        attribution: "Photos: Flickr. This product uses the Flickr API but is not endorsed or certified by SmugMug, Inc.",
        description: "Photos uploaded to Flickr in the last 24 hours with a position. Zoom in to see them. Worldwide. Needs a free Flickr API key: see README.",
        view: () => import("./PhotosLayer"),
      },
    ],
    profilers: { post: () => import("./PostProfile") },
    nearby: [{ id: "posts.nearby", title: "Sightings and street reports", order: 40, refreshMs: 10 * 60_000, attribution: "Sightings: iNaturalist · Reports: Fix My Street Brussels (CC0)", load: () => import("./nearby") }],
    tiles: [{ id: "posts.near", title: "Posted near you", order: 45, view: () => import("./Tile") }],
  },
});
