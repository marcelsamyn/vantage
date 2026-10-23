import { Plane, Ship } from "lucide-react";
import { fmt } from "../../app/core/format";
import type { NearbyItem, NearbyProvider } from "../../app/core/nearby";
import { profile } from "../../app/core/profile";
import { useSettings, type Units } from "../../app/core/settings";
import { destination, distanceM, type LatLon } from "../../shared/geo";
import { fetchShips, type Box } from "./client";
import type { Vessel } from "./types";
import { navStatusName, shipSourceProblem, shipTypeName } from "./vessel";

const MAX = 5;
/** Below this a vessel is lying still, and its speed over ground is noise. */
const MOVING_KT = 0.5;

/** The ships near you, nearest first, as one item each. */
export function shipItems(vessels: readonly Vessel[], at: LatLon, radiusM: number, units: Units): NearbyItem[] {
  return vessels
    .map((v) => ({ v, d: distanceM(at, v) }))
    .filter((x) => x.d <= radiusM)
    .sort((a, b) => a.d - b.d)
    .slice(0, MAX)
    .map(({ v }): NearbyItem => {
      const entity = { kind: "ship", id: String(v.mmsi), data: v } as const;
      const moving = v.sogKt !== null && v.sogKt >= MOVING_KT;
      return {
        id: String(v.mmsi),
        title: v.name ?? `MMSI ${v.mmsi}`,
        detail: [v.reportKind === "sar-aircraft" ? "Search-and-rescue aircraft" : shipTypeName(v.shipType), moving ? fmt.speedKnots(v.sogKt ?? 0, units) : (navStatusName(v.navStatus) ?? "Not moving"), v.flag].filter(Boolean).join(" · "),
        kind: "see",
        at: { lat: v.lat, lon: v.lon },
        icon: v.reportKind === "sar-aircraft" ? Plane : Ship,
        tone: "sodium",
        live: true,
        entity,
        primary: { label: "Show ship", run: () => profile.open(entity) },
      };
    });
}

/** The box around you that holds the radius, which is what the ships route takes. */
export function boxAround(at: LatLon, radiusM: number): Box {
  return {
    north: destination(at, 0, radiusM).lat,
    south: destination(at, 180, radiusM).lat,
    east: destination(at, 90, radiusM).lon,
    west: destination(at, 270, radiusM).lon,
  };
}

/** Reuse the map feed, with the same setup and source failure messages. */
const nearby: NearbyProvider = async ({ at, radiusM }, signal) => {
  const data = await fetchShips(boxAround(at, radiusM), signal);
  const problem = shipSourceProblem(data);
  if (problem) throw new Error(problem);
  return shipItems(data.vessels, at, radiusM, useSettings.getState().units);
};
export default nearby;
