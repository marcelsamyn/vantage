import type { NearbyProvider } from "../../app/core/nearby";
import { fetchCounters } from "./client";
import { counterItems } from "./nearby";

/** The server caches the counters for a minute. */
const nearby: NearbyProvider = async ({ at, radiusM }, signal) => counterItems(await fetchCounters(signal), at, radiusM);
export default nearby;
