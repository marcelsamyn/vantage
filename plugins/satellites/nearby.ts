import { Satellite } from "lucide-react";
import { api } from "../../app/core/api";
import { go } from "../../app/core/nav";
import type { NearbyItem, NearbyProvider } from "../../app/core/nearby";
import { compassPoint, type LatLon } from "../../shared/geo";
import { CREWED, displayName, passes, satFromRef, type Pass } from "./client";
import type { SatelliteRef, TleSet } from "./types";

/** How far ahead to look for a pass you can see with your eyes. */
const HORIZON_H = 24;
/** Passes barely change within an hour for the same spot, so they are worked out once an hour. */
const KEEP_MS = 3_600_000;

const cache = new Map<string, { at: number; pass: Pass | null }>();

function nextVisible(ref: SatelliteRef, at: LatLon, now: number): Pass | null {
  const key = `${ref.norad}:${at.lat.toFixed(2)},${at.lon.toFixed(2)}`;
  const hit = cache.get(key);
  if (hit && now - hit.at < KEEP_MS && (!hit.pass || hit.pass.set.getTime() > now)) return hit.pass;
  const pass = passes(satFromRef(ref).rec, at, new Date(now), HORIZON_H).find((p) => p.visible && p.set.getTime() > now) ?? null;
  cache.set(key, { at: now, pass });
  return pass;
}

export function passItem(ref: SatelliteRef, pass: Pass): NearbyItem {
  const name = displayName(ref.name);
  return {
    id: `${ref.norad}:${pass.rise.getTime()}`,
    title: `${name} passes over`,
    detail: `Rises ${compassPoint(pass.riseAz)}, ${Math.round(pass.peakEl)}° high at best, sets ${compassPoint(pass.setAz)}`,
    kind: "see",
    at: "overhead",
    icon: Satellite,
    tone: "sodium",
    startsAt: pass.rise.getTime(),
    until: pass.set.getTime(),
    entity: { kind: "satellite", id: String(ref.norad), data: ref },
    primary: { label: "Open the sky", run: () => go("sky") },
  };
}

/** The next pass of a crewed station that you can see: sunlit while your sky is dark. Orbits come from the six-hour TLE cache. */
const nearby: NearbyProvider = async ({ at, now }, signal) => {
  const set = await api<TleSet>("/api/satellites/tle?group=stations", { signal });
  return set.tles
    .filter((t) => CREWED(t.name))
    .flatMap((t) => {
      const ref: SatelliteRef = { ...t, group: set.group };
      const pass = nextVisible(ref, at, now);
      return pass ? [passItem(ref, pass)] : [];
    });
};
export default nearby;
