import type { LucideIcon } from "lucide-react";
import { MapPin, Plane, PlaneLanding } from "lucide-react";
import { fmt } from "../../app/core/format";
import type { NearbyItem, NearbyProvider } from "../../app/core/nearby";
import { profile } from "../../app/core/profile";
import { useSettings, type Units } from "../../app/core/settings";
import { distanceM, type LatLon } from "../../shared/geo";
import { altitudeLabel, BALLOON_STALE_MS, fetchBalloons, fetchSondes, isFlying, modelName, projected } from "./client";
import type { AmateurBalloon, Sonde, SondeSnapshot } from "./types";

const MAX = 3;
/** An amateur balloon heard this recently is still transmitting; an older one is its last known place. */
const BALLOON_LIVE_MS = 3_600_000;

const MHZ = (mhz: number | null): string | null => (mhz === null ? null : `${mhz.toFixed(3)} MHz`);
const ICON: Record<Place, LucideIcon> = { flying: Plane, landing: PlaneLanding, ground: MapPin };

type Place = "flying" | "landing" | "ground";
interface Spot {
  s: Sonde;
  place: Place;
  where: LatLon;
  d: number;
}

/**
 * Radiosondes flying within the radius, ones on the ground that long, and ones coming down whose predicted landing is
 * within it. A balloon that lands near you is placed at its landing point, since that is where you would go.
 */
export function sondeItems(snapshot: SondeSnapshot, at: LatLon, radiusM: number, now: number, units: Units): NearbyItem[] {
  return snapshot.sondes
    .flatMap((s): Spot[] => {
      if (s.phase === "lost") return [];
      const here = projected(s, now);
      const landing = s.phase === "descending" ? s.prediction?.landing : undefined;
      if (distanceM(at, here) <= radiusM) return [{ s, place: isFlying(s) ? ("flying" as const) : ("ground" as const), where: here, d: distanceM(at, here) }];
      if (landing && distanceM(at, landing) <= radiusM) return [{ s, place: "landing" as const, where: landing, d: distanceM(at, landing) }];
      return [];
    })
    .sort((a, b) => a.d - b.d)
    .slice(0, MAX)
    .map(({ s, place, where }) => sondeItem(s, place, where, snapshot.fetchedAt, now, units));
}

function sondeItem(s: Sonde, place: Place, where: LatLon, fetchedAt: number, now: number, units: Units): NearbyItem {
  const entity = { kind: "sonde", id: s.serial, data: { ...s, fetchedAt } } as const;
  const model = modelName(s);
  const detail =
    place === "ground"
      ? [model, "on the ground", MHZ(s.frequencyMHz)]
      : place === "landing"
        ? [model, `lands about ${fmt.clock(s.prediction?.landing.at ?? now)}`, `now ${altitudeLabel(s.altM, units)} up`]
        : [model, `${altitudeLabel(s.altM, units)} up`, s.phase === "floating" ? "floating" : s.phase];
  return {
    id: s.serial,
    title: `Radiosonde ${s.serial}`,
    detail: detail.filter(Boolean).join(" · "),
    kind: "see",
    at: { lat: where.lat, lon: where.lon },
    icon: ICON[place],
    tone: place === "ground" ? "fog" : "sodium",
    ...(place === "flying" ? { live: true } : {}),
    entity,
    primary: { label: "Show balloon", run: () => profile.open(entity) },
  };
}

/** Amateur balloons heard within the radius and not long ago, nearest first. */
export function balloonItems(balloons: readonly AmateurBalloon[], at: LatLon, radiusM: number, now: number, units: Units): NearbyItem[] {
  return balloons
    .filter((b) => now - b.seenAt <= BALLOON_STALE_MS)
    .map((b) => ({ b, d: distanceM(at, b) }))
    .filter((x) => x.d <= radiusM)
    .sort((a, b) => a.d - b.d)
    .slice(0, MAX)
    .map(({ b }): NearbyItem => {
      const entity = { kind: "amateurballoon", id: b.id, data: b } as const;
      const heard = now - b.seenAt <= BALLOON_LIVE_MS;
      return {
        id: b.id,
        title: b.name,
        detail: [b.link, altitudeLabel(b.altM, units), b.daysAloft !== null && `day ${b.daysAloft} aloft`, !heard && `heard ${fmt.ago(b.seenAt, now)}`].filter(Boolean).join(" · "),
        kind: "see",
        at: { lat: b.lat, lon: b.lon },
        icon: Plane,
        tone: heard ? "sodium" : "fog",
        ...(heard ? { live: true } : {}),
        entity,
        primary: { label: "Show balloon", run: () => profile.open(entity) },
      };
    });
}

/** The weather balloon map layer's own feed, which the server keeps for 25 seconds. */
export const sondeNearby: NearbyProvider = async ({ at, radiusM, now }, signal) => sondeItems(await fetchSondes(signal), at, radiusM, now, useSettings.getState().units);

/** The amateur balloon layer's own feed, which the server keeps for ten minutes. */
export const balloonNearby: NearbyProvider = async ({ at, radiusM, now }, signal) => balloonItems((await fetchBalloons(signal)).balloons, at, radiusM, now, useSettings.getState().units);
