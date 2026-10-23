import { memo } from "../../server/kit";
import { TransitClock } from "./clock";
import type { TransitSourceHealth } from "./types";
import type { RtFeed, RtVehicle } from "./gtfsrt";

export const transitClock = new TransitClock();
const health = new Map<string, TransitSourceHealth>();

export function stampVehicles(feed: RtFeed): RtVehicle[] {
  const receivedAt = transitClock.now();
  return feed.vehicles.map(vehicle => ({ ...vehicle, receivedAt, ...(feed.timestamp > 0 ? { producedAt: feed.timestamp * 1000 } : {}) }));
}

/** Record the actual attempt inside the cache loader, including failures hidden by stale-cache reuse. */
export function vehicleFeed<T>(source: string, key: string, ttl: number, load: () => Promise<T>, staleMs = ttl * 10): Promise<T> {
  return memo(key, ttl, async () => {
    const previous = health.get(source);
    const attemptedAt = transitClock.now();
    try {
      const value = await load();
      health.set(source, { source, attemptedAt, receivedAt: transitClock.now(), error: null });
      return value;
    } catch (error: unknown) {
      health.set(source, { source, attemptedAt, receivedAt: previous?.receivedAt ?? null, error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }, staleMs);
}

export function sourceHealth(): TransitSourceHealth[] { return [...health.values()]; }
