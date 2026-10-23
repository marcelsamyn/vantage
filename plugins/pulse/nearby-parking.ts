import type { NearbyProvider } from "../../app/core/nearby";
import { fetchParking } from "./client";
import { parkingItems } from "./nearby";

/** The server caches the feeds for a minute, which is also how often the layer asks. */
const nearby: NearbyProvider = async ({ at, radiusM }, signal) => parkingItems(await fetchParking(signal), at, radiusM);
export default nearby;
