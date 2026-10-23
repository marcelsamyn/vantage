import type { FrequencyDip } from "./types";

/**
 * Finds sudden frequency falls in a one-second series.
 *
 * A trip of a large plant or line removes supply in an instant, so the frequency drops tens of
 * millihertz within seconds. The grid also dips on a schedule: generators change output at the
 * quarter hours, and the frequency sags around :00, :15, :30 and :45. Those are expected,
 * so a fall that starts near a quarter hour is not reported.
 */

const BASELINE_FROM_S = 90;
const BASELINE_TO_S = 30;
/** Below the recent level by at least this much, in millihertz. */
const DEPTH_MHZ = 50;
/** ...and already this far below the level 15 seconds earlier, so slow drifts do not count. */
const SUDDEN_MHZ = 35;
const SUDDEN_WINDOW_S = 15;
/** Scheduled ramps start up to 90 s before a quarter hour and run to 60 s after it. */
const RAMP_BEFORE_S = 90;
const RAMP_AFTER_S = 60;
/** One event, not one per second of the fall. */
const QUIET_S = 180;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? (sorted[mid] ?? 0) : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

function nearQuarterHour(unixS: number): boolean {
  const intoQuarter = unixS % 900;
  return intoQuarter <= RAMP_AFTER_S || intoQuarter >= 900 - RAMP_BEFORE_S;
}

export function detectDips(t: readonly number[], hz: readonly number[]): FrequencyDip[] {
  const dips: FrequencyDip[] = [];
  let lastAt = -Infinity;
  let from = 0;
  let to = 0;
  let back = 0;
  for (let i = 0; i < t.length; i++) {
    const now = t[i] ?? 0;
    // The three cursors only move forward, so the scan stays linear.
    while (from < i && now - (t[from] ?? 0) > BASELINE_FROM_S) from++;
    while (to < i && now - (t[to] ?? 0) >= BASELINE_TO_S) to++;
    while (back < i && now - (t[back] ?? 0) > SUDDEN_WINDOW_S) back++;
    const window = hz.slice(from, to);
    if (window.length < 20) continue;
    const drop = ((hz[i] ?? 0) - median(window)) * 1000;
    const quick = ((hz[i] ?? 0) - (hz[back] ?? 0)) * 1000;
    if (drop > -DEPTH_MHZ || quick > -SUDDEN_MHZ || now - lastAt < QUIET_S || nearQuarterHour(now)) continue;
    let low = hz[i] ?? 0;
    for (let k = i; k < t.length && (t[k] ?? 0) - now <= 60; k++) low = Math.min(low, hz[k] ?? low);
    dips.push({ at: now, depthMhz: Math.round(-(low - median(window)) * 1000) });
    lastAt = now;
  }
  return dips;
}
