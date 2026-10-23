import { Plane } from "lucide-react";
import { api, qs } from "../../app/core/api";
import { fmt } from "../../app/core/format";
import type { NearbyItem, NearbyProvider } from "../../app/core/nearby";
import { profile } from "../../app/core/profile";
import { useSettings, type Units } from "../../app/core/settings";
import { compassPoint, lookAngle, type LatLon } from "../../shared/geo";
import { AROUND_NM, fetchNear, projected, useTraffic } from "./client";
import type { Aircraft, AircraftPhoto, AircraftSnapshot } from "./types";

/** High enough above the horizon to see by looking up. */
const OVERHEAD_EL = 25;
const MAX = 3;
/** A position stops counting as overhead after this; the next refresh brings a fresh one. */
const STALE_MS = 2 * 60_000;

export interface Overhead {
  aircraft: Aircraft;
  el: number;
}

/** Airborne aircraft at least 25° above your horizon at `now`, by dead reckoning from the snapshot, highest first. */
export function overhead(snapshot: AircraftSnapshot, at: LatLon, now: number): Overhead[] {
  return snapshot.aircraft
    .flatMap((a) => {
      if (a.onGround || a.altFt === null) return [];
      const p = projected(a, snapshot.fetchedAt, now);
      return [{ aircraft: a, el: lookAngle(at, { lat: p.lat, lon: p.lon, altM: a.altFt * 0.3048 }).el }];
    })
    .filter((o) => o.el >= OVERHEAD_EL)
    .sort((a, b) => b.el - a.el)
    .slice(0, MAX);
}

/** One item for an aircraft overhead; `fetchedAt` is the snapshot time its position was reckoned from. */
export function planeItem({ aircraft: a, el }: Overhead, fetchedAt: number, units: Units, photo: AircraftPhoto | null): NearbyItem {
  const entity = { kind: "aircraft", id: a.hex, data: { ...a, fetchedAt } } as const;
  const heading = a.trackDeg === null ? null : `heading ${compassPoint(a.trackDeg)}`;
  return {
    id: a.hex,
    title: a.callsign ?? a.registration ?? a.hex.toUpperCase(),
    detail: [a.typeName ?? a.typeCode, a.altFt !== null && fmt.altitude(a.altFt, units), `${Math.round(el)}° up`, heading].filter(Boolean).join(" · "),
    kind: "see",
    at: "overhead",
    icon: Plane,
    tone: "sodium",
    live: true,
    until: fetchedAt + STALE_MS,
    ...(photo ? { image: photo.thumb } : {}),
    entity,
    primary: { label: "Follow it", run: () => profile.open(entity) },
  };
}

/**
 * What the sky holds right now, from the snapshot the aircraft watcher keeps fresh. It asks the server itself only
 * when the watcher has nothing recent, and the server shares that answer with the watcher's next poll.
 */
const nearby: NearbyProvider = async ({ at, now }, signal) => {
  const watched = useTraffic.getState().snapshot;
  const snapshot = watched && now - watched.fetchedAt < STALE_MS ? watched : await fetchNear(at, AROUND_NM, signal);
  const units = useSettings.getState().units;
  // Photos are kept for a day on the server and an hour in the browser, so asking again costs nothing. A photo that
  // fails to load only leaves its row without a picture.
  const planes = overhead(snapshot, at, now);
  const photos = await Promise.all(planes.map(({ aircraft }) => api<AircraftPhoto | null>(qs("/api/aircraft/photo", { hex: aircraft.hex }), { signal }).catch(() => null)));
  return planes.map((o, i) => planeItem(o, snapshot.fetchedAt, units, photos[i] ?? null));
};
export default nearby;
