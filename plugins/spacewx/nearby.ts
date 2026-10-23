import { Sparkles } from "lucide-react";
import type { NearbyItem, NearbyProvider } from "../../app/core/nearby";
import type { LatLon } from "../../shared/geo";
import { fetchAuroraAt, isDark } from "./client";
import type { AuroraPoint } from "./types";

/** The chance overhead at which NOAA draws the equatorward edge of the oval. */
const OVERHEAD_PCT = 10;

/** One "here" item when aurora can be seen from your spot and the sky is dark enough to see it. */
export function auroraItems(aurora: AuroraPoint, at: LatLon, now: number): NearbyItem[] {
  if (!isDark(at, new Date(now))) return [];
  const overhead = aurora.chancePct >= OVERHEAD_PCT;
  const onHorizon = aurora.reachLat !== null && Math.abs(aurora.reachLat) <= Math.abs(at.lat);
  if (!overhead && !onHorizon) return [];
  return [
    {
      id: "aurora",
      title: "Aurora may be visible",
      detail: overhead ? `${Math.round(aurora.chancePct)} % chance overhead` : `Look low on the ${at.lat >= 0 ? "northern" : "southern"} horizon`,
      kind: "see",
      at: "here",
      icon: Sparkles,
      tone: "mint",
      live: true,
      primary: { label: "Show the oval", run: () => import("../city/client").then((m) => m.showLayer("spacewx.aurora")) },
    },
  ];
}

/** NOAA's OVATION nowcast, which the server refreshes every five minutes. */
const nearby: NearbyProvider = async ({ at, now }, signal) => auroraItems(await fetchAuroraAt(at, signal), at, now);
export default nearby;
