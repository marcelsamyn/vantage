import { api, qs } from "../../app/core/api";
import type { LatLon } from "../../shared/geo";
import type { Article, ArticleSummary } from "./types";

export function fetchArticlesNear(center: LatLon, radiusM: number, signal?: AbortSignal): Promise<Article[]> {
  return api<Article[]>(qs("/api/places/near", { lat: center.lat.toFixed(4), lon: center.lon.toFixed(4), radiusM: Math.round(radiusM) }), { signal });
}

export function fetchSummary(title: string, signal?: AbortSignal): Promise<ArticleSummary> {
  return api<ArticleSummary>(qs("/api/places/summary", { title }), { signal });
}
