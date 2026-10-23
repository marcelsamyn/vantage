/**
 * Which eras really have a picture at a place. A source's bounding box says where it could have data;
 * a survey flown along a few strips leaves most of that box empty. One tile request per era tells the truth,
 * and the answer never changes, so it is kept for a day.
 */
import { HttpError, describe, fetchUpstream, log, memo } from "../../server/kit";
import { covers, tileAt, tileUrl, type EraDef } from "./catalog.server";

/** A tile at this zoom is about 5 km wide at Belgian latitudes: wide enough to mean "this area", small enough to be local. */
const PROBE_ZOOM = 13;
const KEEP_MS = 24 * 3_600_000;
const SIMULTANEOUS = 8;
const PROBE_TIMEOUT_MS = 9_000;

export interface Coverage {
  covered: EraDef[];
  /** Publishers that did not answer, so their eras are unknown rather than absent. */
  unreachable: string[];
}

/** One tile request. A connection that the publisher dropped between requests gets one more try. */
async function fetchTile(def: EraDef, url: string): Promise<Response> {
  const ask = (): Promise<Response> => fetchUpstream(def.publisher, url, { headers: { accept: "image/*" }, timeoutMs: PROBE_TIMEOUT_MS });
  try {
    return await ask();
  } catch (err) {
    if (err instanceof HttpError && err.code === "upstream_unreachable") return ask();
    throw err;
  }
}

/** The tile request that checks one era at one place. Throws when the publisher does not answer. */
async function hasPicture(def: EraDef, lat: number, lon: number): Promise<boolean> {
  const z = Math.min(Math.max(PROBE_ZOOM, def.minzoom), def.maxzoom);
  const { x, y } = tileAt(lat, lon, z);
  return memo(
    `timemachine:${def.id}:${z}/${x}/${y}`,
    KEEP_MS,
    async () => {
      let res: Response;
      try {
        res = await fetchTile(def, tileUrl(def.tiles, z, x, y));
      } catch (err) {
        // 4xx means "no tile here". Timeouts and 5xx mean the publisher is down, which is a different answer.
        const status = err instanceof HttpError && err.code === "upstream_status" ? Number(/HTTP (\d{3})/.exec(err.message)?.[1]) : NaN;
        if (status >= 400 && status < 500) return false;
        throw err;
      }
      if (!(res.headers.get("content-type") ?? "").startsWith("image/")) {
        await res.body?.cancel();
        return false;
      }
      // The declared length answers the question without downloading the picture.
      const declared = Number(res.headers.get("content-length"));
      if (declared > 0) {
        await res.body?.cancel();
        return declared > def.blankMaxBytes;
      }
      return (await res.arrayBuffer()).byteLength > def.blankMaxBytes;
    },
  );
}

/** Eras from `defs` that have a picture at the point. Global eras are always kept. */
export async function coveringEras(defs: readonly EraDef[], lat: number, lon: number): Promise<Coverage> {
  const candidates = defs.filter((d) => d.global || covers(d.bbox, lat, lon));
  const answers = new Array<boolean | null>(candidates.length).fill(null);
  const down = new Set<string>();

  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < candidates.length) {
      const i = next++;
      const def = candidates[i];
      if (!def) return;
      if (def.global) {
        answers[i] = true;
        continue;
      }
      try {
        answers[i] = await hasPicture(def, lat, lon);
      } catch (err) {
        log.warn("era coverage check failed", { era: def.id, publisher: def.publisher, error: describe(err) });
        down.add(def.publisher);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(SIMULTANEOUS, candidates.length) }, worker));

  return { covered: candidates.filter((_, i) => answers[i] === true), unreachable: [...down] };
}
