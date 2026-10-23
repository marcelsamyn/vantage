import type { NearbyProvider } from "../../app/core/nearby";
import { fetchRivers } from "./client";
import { riverBox, riverItems } from "./nearby";

/** Gauges come from the same cached route as the layer, for a box around you. */
const nearby: NearbyProvider = async ({ at, radiusM }, signal) => riverItems(await fetchRivers(riverBox(at, radiusM), signal), at, radiusM);
export default nearby;
