import { HttpError, defineSource, json, parseQuery, z } from "../../server/kit";
import { loadDsn } from "./dsn.server";
import { EARTH_ID, PLANETS, PROBES, earthDistanceKm, loadedBody, nameOfKnown, refusalFor, settle, snapshot, want, type Named } from "./horizons.server";
import { buildProfile } from "./profile.server";
import type { DsnSnapshot, SpacecraftRef } from "./types";

/** How long a profile waits for JPL before it shows what the Deep Space Network knows. */
const PROFILE_WAIT_MS = 12_000;

/** Spacecraft with a link right now. Their ids go to the front of the Horizons queue. */
const linkedCraft = (dsn: DsnSnapshot | null): SpacecraftRef[] => {
  const seen = new Map<number, SpacecraftRef>();
  for (const link of dsn?.links ?? []) if (link.spacecraft.naifId < 0) seen.set(link.spacecraft.naifId, link.spacecraft);
  return [...seen.values()];
};

/** The network feed with distances filled in from whatever Horizons has loaded; never waits for Horizons. */
async function readNetwork(): Promise<DsnSnapshot> {
  const dsn = await loadDsn((id) => earthDistanceKm(id));
  want([EARTH_ID, ...linkedCraft(dsn).map((c) => c.naifId)]);
  return dsn;
}

const spacecraftQuery = z.object({ id: z.coerce.number().int().max(-1) });

export default defineSource({
  probes: [{ name: "Deep Space Network · NASA", url: "https://eyes.nasa.gov/dsn/config.xml" }],
  routes: {
    /** Who is talking to which spacecraft, dish by dish. */
    "GET /dsn": async () => json(await readNetwork()),

    /** Planets and probes with positions from JPL Horizons. Loads in the background and reports how many are still pending. */
    "GET /system": async () => {
      // The network feed names the spacecraft that deserve a place on the map today; if it is down, the fixed list still works.
      const dsn = await loadDsn((id) => earthDistanceKm(id)).catch(() => null);
      const extras: Named[] = linkedCraft(dsn).map((c) => ({ id: c.naifId, name: c.name }));
      want([EARTH_ID, ...extras.map((e) => e.id), -31, -32, ...PLANETS.map((p) => p.id), ...PROBES.map((p) => p.id)]);
      return json(snapshot(extras));
    },

    /** One spacecraft: its orbit-derived numbers, who is listening, and facts. Waits briefly for JPL if the body is not loaded yet. */
    "GET /spacecraft": async (req) => {
      const { id } = parseQuery(req, spacecraftQuery);
      const dsn = await readNetwork().catch(() => null);
      const linked = linkedCraft(dsn).find((c) => c.naifId === id);
      const known = nameOfKnown(id);
      const spacecraft: SpacecraftRef | null = known ? { naifId: id, name: known } : (linked ?? null);
      if (!spacecraft) throw new HttpError(404, "unknown_spacecraft", `No spacecraft with id ${id} is on our list or on the Deep Space Network right now.`);

      want([EARTH_ID, id], true);
      await Promise.all([settle(EARTH_ID, PROFILE_WAIT_MS), settle(id, PROFILE_WAIT_MS)]);
      const body = loadedBody({ id, name: spacecraft.name }, "probe");
      const refusal = refusalFor(id);
      const note = body ? null : refusal ? `JPL Horizons has no trajectory for this spacecraft (${refusal}).` : "JPL Horizons has not answered yet. Try again in a few seconds.";
      // Read the network again so link distances use the trajectory that just arrived.
      const fresh = await readNetwork().catch(() => dsn);
      const links = (fresh?.links ?? []).filter((l) => l.spacecraft.naifId === id);
      return json(buildProfile(spacecraft, body, note, links));
    },
  },
});
