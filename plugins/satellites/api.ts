import { HttpError, defineSource, describe, diskMemo, fetchUpstream, json, log, parseQuery, z } from "../../server/kit";
import { SAT_GROUPS, type SatGroup, type Tle, type TleSet } from "./types";

/**
 * Orbital elements from CelesTrak, which publishes them for every tracked public satellite. CelesTrak asks clients
 * not to download a group more than once every two hours, and it can take 20 s to answer or not answer at all.
 *
 * So a request never waits on CelesTrak while a usable set is at hand: the set on disk answers at once, and when it
 * is older than six hours a refresh runs in the background. Elements stay good enough for positions on a map and
 * pass times for days, so only a missing set, or one older than three days, makes a request wait for a download.
 */
const REFRESH_MS = 6 * 3_600_000;
const USABLE_MS = 3 * 24 * 3_600_000;

function parseTle(text: string): Tle[] {
  const lines = text.split(/\r?\n/).map((l) => l.trimEnd()).filter(Boolean);
  const out: Tle[] = [];
  for (let i = 0; i + 2 < lines.length + 1; i += 3) {
    const [name, line1, line2] = [lines[i], lines[i + 1], lines[i + 2]];
    if (!name || !line1?.startsWith("1 ") || !line2?.startsWith("2 ")) continue;
    out.push({ name: name.trim(), norad: Number.parseInt(line1.slice(2, 7), 10), line1, line2 });
  }
  return out;
}

async function download(group: SatGroup): Promise<TleSet> {
  const res = await fetchUpstream("CelesTrak", `https://celestrak.org/NORAD/elements/gp.php?GROUP=${group}&FORMAT=tle`, { timeoutMs: 20_000 });
  const tles = parseTle(await res.text());
  if (tles.length === 0) throw new HttpError(502, "upstream_shape", `CelesTrak returned no satellites for group "${group}"`);
  return { group, fetchedAt: Date.now(), tles };
}

const StoredTleSet = z.object({
  group: z.enum(SAT_GROUPS),
  fetchedAt: z.number(),
  tles: z.array(z.object({ name: z.string(), norad: z.number(), line1: z.string(), line2: z.string() })),
});

/** After a failed refresh, CelesTrak is not asked again for this long. */
const RETRY_MS = 15 * 60_000;

/** Sets refreshed in the background since the disk copy was written; newer than it, until the next restart. */
const refreshed = new Map<SatGroup, TleSet>();
/** When each group was last asked for in the background; one download at a time per group. */
const asked = new Map<SatGroup, number>();

function refreshInBackground(group: SatGroup, age: number): void {
  const last = asked.get(group);
  if (last !== undefined && Date.now() - last < RETRY_MS) return;
  asked.set(group, Date.now());
  download(group)
    .then((set) => refreshed.set(group, set))
    .catch((err: unknown) => log.warn("CelesTrak refresh failed; serving the kept elements", { group, ageH: Math.round(age / 3_600_000), error: describe(err) }));
}

/** What to do with a set `ageMs` old: serve it at once (`usable`), and refresh it in the background (`stale`). */
export function freshness(ageMs: number): { usable: boolean; stale: boolean } {
  return { usable: ageMs < USABLE_MS, stale: ageMs > REFRESH_MS };
}

async function tleSet(group: SatGroup): Promise<TleSet> {
  // A background refresh answers first: the disk copy's own clock would make a request wait once it is three days old.
  const newer = refreshed.get(group);
  const best = newer && freshness(Date.now() - newer.fetchedAt).usable ? newer : await diskMemo(`celestrak-${group}`, USABLE_MS, () => download(group), StoredTleSet, USABLE_MS);
  const age = Date.now() - best.fetchedAt;
  if (freshness(age).stale) refreshInBackground(group, age);
  return best;
}

export default defineSource({
  probes: [{ name: "Satellites · CelesTrak", url: "https://celestrak.org/NORAD/elements/gp.php?CATNR=25544&FORMAT=tle" }],
  routes: {
    "GET /tle": async (req) => {
      const { group } = parseQuery(req, z.object({ group: z.enum(SAT_GROUPS) }));
      return json(await tleSet(group), { maxAge: 3600 });
    },
  },
});
