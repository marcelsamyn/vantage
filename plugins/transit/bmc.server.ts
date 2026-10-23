import { HttpError, fetchUpstream, log } from "../../server/kit";
import { IDENTITY } from "./http.server";

/**
 * The Belgian Mobility Company's open data portal: live feeds of STIB, TEC, De Lijn and SNCB (CC BY 4.0).
 * It answers without a key under a small per-minute allowance; a free developer key in
 * VANTAGE_BELGIAN_MOBILITY_KEY raises it.
 */
export const BMC_BASE = "https://api-management-opendata-production.azure-api.net/api";
export const BMC_KEY = "VANTAGE_BELGIAN_MOBILITY_KEY";
/** How long to wait when the portal refuses without saying for how long: a refused key will not start working soon. */
const REFUSED_MS = 3_600_000;
const RATE_LIMITED_MS = 60_000;
/** A portal that is down or slow gets a short rest, so the map's refreshes do not pile onto it. */
const FAILED_MS = 30_000;

let pausedUntil = 0;

export const bmcKey = (): string | null => process.env[BMC_KEY]?.trim() || null;

/** How long to keep an answer: anonymous callers ask four times less often. */
export const bmcTtl = (withKeyMs: number): number => (bmcKey() ? withKeyMs : withKeyMs * 4);

/** How long to leave the portal alone after a failure: as long as it asked ("…; retry in 21 s"), an hour for a refused key. */
export function pauseFor(err: HttpError): number {
  if (err.code === "upstream_rate_limited") return Number(/retry in (\d+) s/.exec(err.message)?.[1] ?? 0) * 1000 || RATE_LIMITED_MS;
  return /HTTP 40[13]$/.test(err.message) ? REFUSED_MS : FAILED_MS;
}

/**
 * Fetch from the portal, with the key when there is one. After a failure every call waits a while, as long as the
 * portal asked when it says, so the dashboard does not keep the allowance spent.
 */
export async function bmcFetch(source: string, path: string, accept: string): Promise<Response> {
  const key = bmcKey();
  if (Date.now() < pausedUntil) {
    const hint = key ? "" : ` Set ${BMC_KEY} for a larger allowance.`;
    throw new HttpError(503, "upstream_rate_limited", `${source}: waiting ${Math.ceil((pausedUntil - Date.now()) / 1000)} s before asking the Belgian Mobility portal again.${hint}`);
  }
  try {
    return await fetchUpstream(source, `${BMC_BASE}${path}`, { headers: { "user-agent": IDENTITY, accept, ...(key ? { "bmc-partner-key": key } : {}) }, timeoutMs: 15_000 });
  } catch (err) {
    if (err instanceof HttpError) {
      const pause = pauseFor(err);
      pausedUntil = Date.now() + pause;
      log.warn("Belgian Mobility portal call failed; pausing", { source, pauseS: pause / 1000, withKey: key !== null, error: err.message });
    }
    throw err;
  }
}
