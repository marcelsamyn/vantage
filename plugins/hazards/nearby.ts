import { Activity } from "lucide-react";
import type { NearbyItem, NearbyProvider } from "../../app/core/nearby";
import { fmt } from "../../app/core/format";
import { profile } from "../../app/core/profile";
import { useSettings, type Units } from "../../app/core/settings";
import { distanceM, type LatLon } from "../../shared/geo";
import { fetchQuakes } from "./client";
import type { Quake } from "./types";

const SHOWN = 3;
const DAY_MS = 86_400_000;
/** Below this, a quake is a faint tremor that nobody feels even above it. */
const FELT_MIN_MAG = 3;
/** Below this, a quake further away than the radius is not worth a row. */
const LISTED_MIN_MAG = 2.5;

/** How far a quake is usually felt, in metres: about 10 km at M3, tripling with each whole step up. A rule of thumb, not a shake map. */
export const feltRadiusM = (mag: number): number => 10 ** (0.5 * mag - 0.5) * 1000;

/** Quakes of the last day: ones likely felt where you stand are conditions of your area, others inside the radius sit on the map. Strongest first. */
export function quakeItems(quakes: readonly Quake[], at: LatLon, radiusM: number, now: number, units: Units): NearbyItem[] {
  return quakes
    .filter((q) => now - q.time <= DAY_MS && q.time <= now + 60_000)
    .map((q) => ({ q, d: distanceM(at, q) }))
    .map((x) => ({ ...x, felt: x.q.mag >= FELT_MIN_MAG && x.d <= feltRadiusM(x.q.mag) }))
    .filter((x) => x.felt || (x.q.mag >= LISTED_MIN_MAG && x.d <= radiusM))
    .sort((a, b) => Number(b.felt) - Number(a.felt) || b.q.mag - a.q.mag || a.d - b.d)
    .slice(0, SHOWN)
    .map(({ q, felt }): NearbyItem => {
      const entity = { kind: "quake", id: q.id, data: q } as const;
      return {
        id: q.id,
        title: `Earthquake M ${q.mag.toFixed(1)}`,
        detail: `${q.place} · ${fmt.distance(q.depthKm * 1000, units)} deep · ${fmt.ago(q.time, now)}${felt ? " · may have been felt here" : ""}`,
        kind: "see",
        at: felt ? "here" : { lat: q.lat, lon: q.lon },
        icon: Activity,
        tone: q.mag >= 5 ? "alarm" : "sodium",
        entity,
        primary: { label: "Details", run: () => profile.open(entity) },
      };
    });
}

/** The server merges USGS, EMSC and INGV and answers the day's list from a one-minute cache. */
const nearby: NearbyProvider = async ({ at, radiusM, now }, signal) => quakeItems(await fetchQuakes("day", signal), at, radiusM, now, useSettings.getState().units);
export default nearby;
