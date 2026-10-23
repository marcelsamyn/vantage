import { useMemo } from "react";
import { useProfile } from "../../app/core/profile";
import { destination } from "../../shared/geo";
import { MAP_INK, useGeoJsonLayer, type MapLayerProps } from "../city/extension";
import { usePostsInView } from "./client";
import { GROUP_LOOK, fadeFor } from "./look";
import { openPost, usePostMarks, type Mark } from "./marks";
import { isApproximate } from "./precision";
import type { Sighting } from "./types";
import "./posts.css";

const DAY_MS = 24 * 3_600_000;

function circle(s: Sighting): GeoJSON.Position[] {
  const radius = s.uncertaintyM ?? 0;
  return Array.from({ length: 65 }, (_, i) => {
    const p = destination(s, (i / 64) * 360, radius);
    return [p.lon, p.lat];
  });
}

/** iNaturalist posts of the last 24 hours: dots by life group, photos when zoomed in, soft circles where the spot is hidden. */
export default function SightingsLayer({ map, report }: MapLayerProps): null {
  const { posts, arrivals, zoom } = usePostsInView(map, "inaturalist", 2 * 60_000, report);
  const selected = useProfile((s) => (s.entity?.kind === "post" ? s.entity.id : null));

  const { marks, hidden } = useMemo(() => {
    const now = Date.now();
    const exact: Mark[] = [];
    const approximate: { post: Sighting; fade: number }[] = [];
    for (const post of posts ?? []) {
      const fade = fadeFor(now - Date.parse(post.postedAt), DAY_MS);
      if (isApproximate(post)) approximate.push({ post, fade });
      else exact.push({ post, ink: GROUP_LOOK[post.kind].ink, hollow: GROUP_LOOK[post.kind].hollow, fade });
    }
    return { marks: exact, hidden: approximate };
  }, [posts]);

  usePostMarks(map, "posts-sightings", marks, arrivals, zoom);

  // A hidden spot is a soft disc of the area that holds it, never a dot that would claim a place.
  const areas = useMemo(
    (): GeoJSON.FeatureCollection => ({
      type: "FeatureCollection",
      features: hidden.map(({ post, fade }) => ({
        type: "Feature",
        properties: { id: post.id, ink: GROUP_LOOK[post.kind].ink, fade, selected: post.id === selected },
        geometry: { type: "Polygon", coordinates: [circle(post)] },
      })),
    }),
    [hidden, selected],
  );
  const labels = useMemo(
    (): GeoJSON.FeatureCollection => ({
      type: "FeatureCollection",
      features: hidden.map(({ post, fade }) => ({
        type: "Feature",
        properties: { id: post.id, label: `${post.title}\napproximate`, ink: GROUP_LOOK[post.kind].ink, fade, selected: post.id === selected },
        geometry: { type: "Point", coordinates: [post.lon, post.lat] },
      })),
    }),
    [hidden, selected],
  );

  useGeoJsonLayer(map, {
    id: "posts-sightings-areas",
    data: areas,
    fadeBy: "id",
    belowLabels: true,
    layers: (source) => [
      {
        id: `${source}-fill`,
        type: "fill",
        source,
        paint: { "fill-color": ["case", ["get", "selected"], MAP_INK.ice, ["get", "ink"]], "fill-opacity": ["*", 0.07, ["get", "fade"]] },
      },
      {
        id: `${source}-edge`,
        type: "line",
        source,
        paint: {
          "line-color": ["case", ["get", "selected"], MAP_INK.ice, ["get", "ink"]],
          "line-opacity": ["*", 0.45, ["get", "fade"]],
          "line-width": 1,
          "line-dasharray": [2, 3],
        },
      },
    ],
  });

  // Only the label opens the post: a disc tens of kilometres wide would otherwise swallow every click on the map.
  useGeoJsonLayer(map, {
    id: "posts-sightings-approx",
    data: labels,
    fadeBy: "id",
    clickable: ["posts-sightings-approx-label"],
    onClick: (f) => {
      const post = hidden.find((h) => h.post.id === String(f.properties.id))?.post;
      if (post) openPost(post);
    },
    layers: (source) => [
      {
        id: `${source}-label`,
        type: "symbol",
        source,
        layout: { "text-field": ["get", "label"], "text-font": ["Noto Sans Regular"], "text-size": 10.5, "text-max-width": 12, "text-allow-overlap": false },
        paint: {
          "text-color": ["case", ["get", "selected"], MAP_INK.ice, ["get", "ink"]],
          "text-opacity": ["max", 0.5, ["get", "fade"]],
          "text-halo-color": MAP_INK.void,
          "text-halo-width": 1.4,
        },
      },
    ],
  });

  return null;
}
