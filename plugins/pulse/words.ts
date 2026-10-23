import type { ParkTone } from "./icons";
import type { CarPark, RiverStatus } from "./types";

/** How a car park reads: a closed house is grey, a nearly full one red, a busy one amber, the rest green. */
export function parkTone(p: CarPark): ParkTone {
  if (!p.open || p.free === null) return "closed";
  if (p.free === 0 || (p.capacity !== null && p.free / p.capacity < 0.05)) return "alarm";
  if (p.capacity !== null && p.free / p.capacity < 0.2) return "sodium";
  return "mint";
}

/** Share of a car park that is taken, 0 to 1. */
export const parkOccupied = (p: CarPark): number => (p.capacity && p.free !== null ? 1 - Math.min(1, p.free / p.capacity) : 0);

/** A level in metres, with two decimals below ten metres. */
export const levelText = (m: number): string => `${m.toFixed(Math.abs(m) < 10 ? 2 : 1)} m`;

export const STATUS_WORDS: Record<RiverStatus, string> = {
  normal: "normal",
  elevated: "elevated",
  high: "high",
  unknown: "no thresholds published",
};

/** "rising 0.12 m in 3 h", "steady", "falling 0.30 m in 3 h". Changes under 2 cm count as steady. */
export function trendText(trend3h: number | null): string | null {
  if (trend3h === null) return null;
  if (Math.abs(trend3h) < 0.02) return "steady over 3 h";
  return `${trend3h > 0 ? "rising" : "falling"} ${Math.abs(trend3h).toFixed(2)} m in 3 h`;
}
