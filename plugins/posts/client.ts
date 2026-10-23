import type { Map as MapLibreMap } from "maplibre-gl";
import { useEffect, useMemo, useRef } from "react";
import { api, qs } from "../../app/core/api";
import { usePoll, type Polled } from "../../app/core/hooks";
import type { LatLon } from "../../shared/geo";
import { useMapView, type LayerStatus } from "../city/extension";
import { GRID_CELLS, boxKey, focusBox, snapBox } from "./box";
import type { NearSummary, PostOf, PostSourceId, PostsReply, SourceStatus } from "./types";

/** The viewer's language, for species and street names. */
export const viewerLocale = (): string => (typeof navigator === "undefined" ? "en" : navigator.language || "en");

export function fetchSources(signal?: AbortSignal): Promise<SourceStatus[]> {
  return api<SourceStatus[]>("/api/posts/sources", { signal });
}

export function fetchNear(at: LatLon, signal?: AbortSignal): Promise<NearSummary> {
  return api<NearSummary>(qs("/api/posts/near", { lat: at.lat.toFixed(3), lon: at.lon.toFixed(3), locale: viewerLocale() }), { signal });
}

export function useSources(): Polled<SourceStatus[]> {
  return usePoll((signal) => fetchSources(signal), null, []);
}

const NONE: ReadonlySet<string> = new Set();

/**
 * Sources whose answer is capped (the newest 200 or 250, or one search circle) ask about the area near the map centre,
 * so the horizon of a tilted map cannot crowd out what you look at. Street reports come whole for their region.
 */
const CAPPED: Record<PostSourceId, boolean> = { inaturalist: true, fixmystreet: false, youtube: true, flickr: true };

export interface PostsInView<S extends PostSourceId> {
  posts: PostOf<S>[] | null;
  /** Posts that appeared since the previous refresh of the same area, so they can drop in once. */
  arrivals: ReadonlySet<string>;
  zoom: number;
}

/**
 * Posts of one source in the visible map area, refreshed every `intervalMs`. Reports its state to the layer panel.
 * An optional source without a key fetches nothing and says so.
 */
export function usePostsInView<S extends PostSourceId>(map: MapLibreMap, source: S, intervalMs: number, report: (status: Partial<LayerStatus>) => void): PostsInView<S> {
  const view = useMapView(map);
  const sources = useSources();
  const configured = sources.data?.find((s) => s.id === source)?.configured;
  const canvas = map.getCanvas();
  const area = CAPPED[source] ? focusBox(view, view.center, view.zoom, canvas.clientWidth, canvas.clientHeight) : view;
  // The server rounds the area to its grid; the browser rounds it the same way only to know when to ask again.
  const key = boxKey(snapBox(area, GRID_CELLS[source]));
  const { west, south, east, north } = area;
  const { data, error, loading } = usePoll(
    (signal) => api<PostsReply<S>>(qs("/api/posts/posts", { source, west, south, east, north, locale: viewerLocale() }), { signal }),
    intervalMs,
    [key, source],
    configured !== true,
  );

  // A refresh of the same area that brings ids the previous answer lacked: those posts arrived while you watched.
  const previous = useRef<{ data: PostsReply<S>; ids: Set<string>; fresh: ReadonlySet<string> } | null>(null);
  const arrivals = useMemo(() => {
    if (!data) return NONE;
    const before = previous.current;
    if (before?.data === data) return before.fresh;
    const ids = new Set(data.posts.map((p) => p.id));
    const sameArea = before && boxKey(before.data.box) === boxKey(data.box);
    const fresh = sameArea ? new Set([...ids].filter((id) => !before.ids.has(id))) : NONE;
    previous.current = { data, ids, fresh };
    return fresh;
  }, [data]);

  const statusError = sources.error?.message ?? (configured === false ? "Needs a free key: see README" : (error?.message ?? null));
  useEffect(() => {
    report({ loading: configured === undefined || (configured && loading && !data), error: statusError, count: configured ? (data?.posts.length ?? null) : null });
  }, [report, configured, loading, data, statusError]);

  return { posts: configured ? (data?.posts ?? null) : null, arrivals, zoom: view.zoom };
}
