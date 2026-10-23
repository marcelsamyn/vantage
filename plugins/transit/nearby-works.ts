import { Construction } from "lucide-react";
import type { NearbyItem, NearbyProvider } from "../../app/core/nearby";
import { profile } from "../../app/core/profile";
import { distanceM, type LatLon } from "../../shared/geo";
import { fetchWorksNear, trackWords, workHours, workTitle } from "./client";
import type { RailWork } from "./types";

/** The nearest few restrictions are enough; a busy station can list dozens. */
const WORKS = 3;
/** The server answers for 5 km at most. */
const MAX_REACH_M = 5_000;

/** The point of the affected track nearest to you: a restriction is a line, and Around me draws a marker. */
function nearestOnTrack(work: RailWork, at: LatLon): LatLon {
  let best: LatLon = at;
  let bestD = Infinity;
  for (const [lon, lat] of work.shape.flat()) {
    const d = distanceM(at, { lat, lon });
    if (d < bestD) {
      bestD = d;
      best = { lat, lon };
    }
  }
  return best;
}

/** Infrabel dates are whole days in local time: a work lasts from the first morning to the end of the last day. */
const dayStart = (iso: string): number => Date.parse(`${iso}T00:00:00`);
const dayEnd = (iso: string): number => Date.parse(`${iso}T23:59:59`);

/** The nearest restrictions on the track, as the server found them near you. Exported on its own, so a test can feed it recorded data. */
export function workItems(found: readonly { work: RailWork; distanceM: number }[], at: LatLon, radiusM: number): NearbyItem[] {
  return found
    .filter((f) => f.distanceM <= radiusM && f.work.shape.length > 0)
    .slice(0, WORKS)
    .map(({ work }): NearbyItem => {
      const place = nearestOnTrack(work, at);
      const entity = { kind: "railwork", id: work.id, data: work } as const;
      return {
        id: work.id,
        title: workTitle(work),
        detail: [work.effect, trackWords(work.tracks), workHours(work)].filter(Boolean).join(" · "),
        kind: "see",
        at: place,
        icon: Construction,
        tone: work.impact === "Major" ? "alarm" : "sodium",
        startsAt: dayStart(work.first),
        until: dayEnd(work.last),
        entity,
        primary: { label: "Show works", run: () => profile.open(entity) },
        more: [{ label: "Walk there", run: () => import("../city/client").then((m) => m.routeTo({ ...place, name: workTitle(work) }, "foot")) }],
      };
    });
}

/** Infrabel's plan changes once a day; the route answers from its cache and the layer asks every half hour. */
const nearby: NearbyProvider = async ({ at, radiusM }, signal) => {
  const reach = Math.min(Math.round(radiusM), MAX_REACH_M);
  return workItems(await fetchWorksNear(at, signal, reach), at, reach);
};
export default nearby;
