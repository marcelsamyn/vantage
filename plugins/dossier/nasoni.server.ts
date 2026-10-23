import { diskMemo, z } from "../../server/kit";
import { overpass } from "../grid/overpass.server";
import type { Nasoni } from "./types";

/**
 * Rome's "nasoni": the cast-iron street fountains that run all day. OpenStreetMap tags them `fountain=nasone`.
 * One query for the whole city, kept for a day; the public Overpass servers ask for that kind of politeness.
 */

const StoredNasoni = z.object({ fountains: z.array(z.object({ id: z.number(), lat: z.number(), lon: z.number(), checked: z.string().nullable() })) });

const ROME_BBOX = "(41.6,12.2,42.2,12.95)";

export function nasoni(): Promise<Nasoni> {
  return diskMemo("dossier-nasoni", 24 * 3_600_000, async () => {
    const elements = await overpass(`node["fountain"="nasone"]${ROME_BBOX};out;`, 40);
    return {
      fountains: elements.flatMap((el) => (el.lat !== undefined && el.lon !== undefined ? [{ id: el.id, lat: el.lat, lon: el.lon, checked: el.tags.check_date ?? null }] : [])),
    };
  }, StoredNasoni);
}
