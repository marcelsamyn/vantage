import type { NearbyProvider } from "../../app/core/nearby";
import { fetchBridges } from "./client";
import { bridgeItems } from "./nearby";

/** The schedule is one national feed that the server caches for two minutes. */
const nearby: NearbyProvider = async ({ at, radiusM, now }, signal) => bridgeItems(await fetchBridges(signal), at, radiusM, now);
export default nearby;
