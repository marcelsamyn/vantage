import { Binoculars, Bird, Construction, Leaf, type LucideIcon } from "lucide-react";
import { api, qs } from "../../app/core/api";
import type { Action } from "../../app/core/action";
import type { NearbyItem, NearbyProvider, NearbyTone } from "../../app/core/nearby";
import { profile } from "../../app/core/profile";
import { distanceM, type LatLon } from "../../shared/geo";
import { viewerLocale } from "./client";
import { GROUP_LOOK, STATUS_LOOK } from "./look";
import type { LifeGroup, Post, PostSourceId, PostsReply, Sighting, StreetReport } from "./types";
import { describeWhen } from "./when";

const SIGHTINGS = 4;
const REPORTS = 3;

const GROUP_ICON: Record<LifeGroup, LucideIcon> = { plants: Leaf, fungi: Leaf, birds: Bird, vertebrates: Binoculars, invertebrates: Binoculars, other: Binoculars };
const GROUP_TONE: Record<LifeGroup, NearbyTone> = { plants: "mint", fungi: "mint", birds: "sodium", vertebrates: "sodium", invertebrates: "fog", other: "fog" };

function walkTo(p: Post): Action {
  return { label: "Walk there", run: () => import("../city/client").then((m) => m.routeTo({ lat: p.lat, lon: p.lon, name: p.title }, "foot")) };
}

function within<P extends Post>(posts: readonly P[], at: LatLon, radiusM: number): P[] {
  return posts.filter((p) => distanceM(at, p) <= radiusM);
}

export function sightingItems(posts: readonly Sighting[], at: LatLon, radiusM: number, now: number): NearbyItem[] {
  // Newest first, as the source sends them; a sighting with a photo shows more, so those lead.
  const near = within(posts, at, radiusM);
  return [...near.filter((p) => p.photo), ...near.filter((p) => !p.photo)].slice(0, SIGHTINGS).map((p) => ({
    id: p.id,
    title: p.title,
    detail: `${p.subtitle ?? GROUP_LOOK[p.kind].label} · ${describeWhen(p.seenAt ?? p.postedAt, now)}`,
    kind: "see",
    at: { lat: p.lat, lon: p.lon },
    icon: GROUP_ICON[p.kind],
    tone: GROUP_TONE[p.kind],
    ...(p.photo ? { image: p.photo.thumb } : {}),
    entity: { kind: "post", id: p.id, data: p },
    primary: { label: "Show it", run: () => profile.open({ kind: "post", id: p.id, data: p }) },
    more: [walkTo(p)],
  }));
}

export function reportItems(posts: readonly StreetReport[], at: LatLon, radiusM: number, now: number): NearbyItem[] {
  return within(posts, at, radiusM)
    .filter((p) => p.detail.status !== "closed")
    .sort((a, b) => distanceM(at, a) - distanceM(at, b))
    .slice(0, REPORTS)
    .map((p) => ({
      id: p.id,
      title: p.title,
      detail: [STATUS_LOOK[p.detail.status].label, p.detail.street, describeWhen(p.postedAt, now)].filter(Boolean).join(" · "),
      kind: "see",
      at: { lat: p.lat, lon: p.lon },
      icon: Construction,
      tone: p.detail.status === "new" ? "sodium" : "fog",
      ...(p.photo ? { image: p.photo.thumb } : {}),
      entity: { kind: "post", id: p.id, data: p },
      primary: { label: "Show report", run: () => profile.open({ kind: "post", id: p.id, data: p }) },
      more: [walkTo(p), ...(p.link ? [{ label: "Open the report", href: p.link }] : [])],
    }));
}

function fetchPosts<S extends PostSourceId>(source: S, at: LatLon, radiusM: number, signal: AbortSignal): Promise<PostsReply<S>> {
  const dLat = radiusM / 111_320;
  const dLon = radiusM / (111_320 * Math.cos((at.lat * Math.PI) / 180));
  return api<PostsReply<S>>(qs("/api/posts/posts", { source, west: at.lon - dLon, south: at.lat - dLat, east: at.lon + dLon, north: at.lat + dLat, locale: viewerLocale() }), { signal });
}

/**
 * Nature sightings of the last days and open street reports near you, from the routes and caches the map layers
 * use. Street reports exist only in the Brussels region; elsewhere the server answers at once with none.
 */
const nearby: NearbyProvider = async ({ at, radiusM, now }, signal) => {
  const [sightings, reports] = await Promise.allSettled([fetchPosts("inaturalist", at, radiusM, signal), fetchPosts("fixmystreet", at, radiusM, signal)]);
  // One source failing leaves the other's posts; only when both fail is there nothing to show.
  if (sightings.status === "rejected" && reports.status === "rejected") throw sightings.reason;
  return [
    ...(sightings.status === "fulfilled" ? sightingItems(sightings.value.posts, at, radiusM, now) : []),
    ...(reports.status === "fulfilled" ? reportItems(reports.value.posts, at, radiusM, now) : []),
  ];
};
export default nearby;
