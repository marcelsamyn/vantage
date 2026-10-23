import { useMemo } from "react";
import type { MapLayerProps } from "../city/extension";
import { usePostsInView } from "./client";
import { PHOTO_INK, fadeFor } from "./look";
import { usePostMarks, type Mark } from "./marks";
import "./posts.css";

const DAY_MS = 24 * 3_600_000;

/** Flickr photos uploaded in the last 24 hours: bone dots, and round photos when zoomed in. */
export default function PhotosLayer({ map, report }: MapLayerProps): null {
  const { posts, arrivals, zoom } = usePostsInView(map, "flickr", 5 * 60_000, report);
  const marks = useMemo((): Mark[] => {
    const now = Date.now();
    return (posts ?? []).map((post) => ({ post, ink: PHOTO_INK, hollow: !post.photo, fade: fadeFor(now - Date.parse(post.postedAt), DAY_MS) }));
  }, [posts]);
  usePostMarks(map, "posts-photos", marks, arrivals, zoom);
  return null;
}
