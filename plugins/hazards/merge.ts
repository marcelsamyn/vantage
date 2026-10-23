import { distanceM } from "../../shared/geo";
import type { Quake, QuakeSource } from "./types";

/** Agencies disagree by seconds in time, tens of kilometres in place and up to a magnitude unit in size. */
const MAX_TIME_GAP_MS = 90_000;
const MAX_DISTANCE_M = 100_000;
const MAX_MAG_GAP = 1.2;
const RECENT_GROUPS = 200;

/** Rough box around Italy and its seas, where INGV is the authority and its record is the one to keep. */
const inItaly = (q: Quake): boolean => q.lat >= 35.3 && q.lat <= 47.3 && q.lon >= 6.4 && q.lon <= 19;

/** Lower is better: the service closest to the ground truth for this place wins. */
function rank(q: Quake): number {
  if (q.source === "INGV") return 0;
  if (q.source === "EMSC") return inItaly(q) ? 2 : 1;
  return inItaly(q) ? 3 : 2;
}

const sameQuake = (a: Quake, b: Quake): boolean => Math.abs(a.time - b.time) <= MAX_TIME_GAP_MS && Math.abs(a.mag - b.mag) <= MAX_MAG_GAP && distanceM(a, b) <= MAX_DISTANCE_M;

/**
 * Combine quake lists from several services into one, newest first, without the same event twice.
 * The best-ranked record of each event is kept; it gains USGS's felt reports and impact data when the USGS record is the one dropped.
 */
export function mergeQuakes(...lists: Quake[][]): Quake[] {
  const all = lists.flat().sort((a, b) => a.time - b.time);
  const groups: Quake[][] = [];
  for (const q of all) {
    let home: Quake[] | undefined;
    // Records of one event lie close in time, so only the most recent groups can match, even in a swarm.
    for (let i = groups.length - 1; i >= Math.max(0, groups.length - RECENT_GROUPS); i--) {
      // A service never lists one quake twice, so a group never holds two records from the same service.
      const group = groups[i];
      if (group && !group.some((g) => g.source === q.source) && group.some((g) => sameQuake(g, q))) {
        home = group;
        break;
      }
    }
    if (home) home.push(q);
    else groups.push([q]);
  }
  return groups
    .map((group) => {
      const [best, ...rest] = [...group].sort((a, b) => rank(a) - rank(b) || b.mag - a.mag);
      if (!best) throw new Error("empty quake group");
      const usgs = group.find((g) => g.source === "USGS");
      const alsoIn = [...new Set(rest.map((r) => r.source))].filter((s): s is QuakeSource => s !== best.source);
      return usgs && best !== usgs ? { ...best, alsoIn, felt: usgs.felt, mmi: usgs.mmi, alert: usgs.alert, tsunami: usgs.tsunami } : { ...best, alsoIn };
    })
    .sort((a, b) => b.time - a.time);
}
