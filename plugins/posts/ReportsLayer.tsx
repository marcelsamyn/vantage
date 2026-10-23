import { useMemo } from "react";
import { useProfile } from "../../app/core/profile";
import { MAP_INK, useGeoJsonLayer, useMapIcon, type MapLayerProps } from "../city/extension";
import { usePostsInView } from "./client";
import { dateIn, daysBetween } from "./days";
import { REPORT_CATEGORIES, STATUS_LOOK, fadeFor, reportIcon, reportSvg } from "./look";
import { openPost } from "./marks";

const WINDOW_DAYS = 7;

/** Fix My Street Brussels reports of the last 7 days: a pictogram per category, tinted by status. */
export default function ReportsLayer({ map, report }: MapLayerProps): null {
  const { posts } = usePostsInView(map, "fixmystreet", 10 * 60_000, report);
  // A fixed list, so the hooks run in the same order on every render. Symbols laid out before their icon exists stay blank.
  const iconsReady = REPORT_CATEGORIES.map((c) => useMapIcon(map, reportIcon(c), reportSvg(c))).every(Boolean);
  const selected = useProfile((s) => (s.entity?.kind === "post" ? s.entity.id : null));
  const byId = useMemo(() => new Map((posts ?? []).map((p) => [p.id, p])), [posts]);

  const data = useMemo((): GeoJSON.FeatureCollection | null => {
    if (!posts || !iconsReady) return null;
    // Dates are Brussels calendar days, so age is counted in whole Brussels days.
    const today = dateIn("Europe/Brussels", Date.now());
    return {
      type: "FeatureCollection",
      // Oldest first, so the newest reports draw on top.
      features: [...posts].reverse().map((p) => ({
        type: "Feature",
        properties: {
          id: p.id,
          icon: reportIcon(p.kind),
          ink: STATUS_LOOK[p.detail.status].ink,
          fade: fadeFor(daysBetween(p.postedAt, today), WINDOW_DAYS),
          selected: p.id === selected,
        },
        geometry: { type: "Point", coordinates: [p.lon, p.lat] },
      })),
    };
  }, [posts, selected, iconsReady]);

  useGeoJsonLayer(map, {
    id: "posts-reports",
    data,
    fadeBy: "id",
    clickable: ["posts-reports-icon"],
    onClick: (f) => {
      const post = byId.get(String(f.properties.id));
      if (post) openPost(post);
    },
    layers: (source) => [
      {
        id: `${source}-icon`,
        type: "symbol",
        source,
        layout: {
          "icon-image": ["get", "icon"],
          "icon-size": ["interpolate", ["linear"], ["zoom"], 12, 0.34, 14, 0.48, 16, 0.7, 18, 0.85],
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
          "symbol-sort-key": ["case", ["get", "selected"], 1, 0],
        },
        paint: {
          "icon-color": ["case", ["get", "selected"], MAP_INK.ice, ["get", "ink"]],
          "icon-opacity": ["get", "fade"],
          "icon-halo-color": MAP_INK.void,
          "icon-halo-width": 1.2,
        },
      },
    ],
  });

  return null;
}
