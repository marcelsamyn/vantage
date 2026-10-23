/** Where a year sits on the timeline, from 0 (oldest) to 1 (now). */

const EARLIEST_YEAR = 1550;
/** Leaves room on the right for "yesterday" and "today" to stand apart. */
export const END_YEAR = new Date().getFullYear() + 10;

/**
 * The square root of the time left until now. It gives each recent decade more room than an old one,
 * which matches how the maps are spread: a few from before 1900, a dozen aerial surveys after 1945.
 */
export function yearToFraction(year: number, startYear: number, endYear = END_YEAR): number {
  const clamped = Math.min(endYear, Math.max(startYear, year));
  return 1 - Math.sqrt(endYear - clamped) / Math.sqrt(endYear - startYear);
}

/** Where the ruler begins for a place whose oldest picture is from `oldestYear`: a little before it, on a round year. */
export function rulerStart(oldestYear: number, endYear = END_YEAR): number {
  const margin = Math.max(8, (endYear - oldestYear) * 0.06);
  return Math.max(EARLIEST_YEAR, Math.floor((oldestYear - margin) / 5) * 5);
}

const TICK_STEPS = [5, 10, 25, 50, 100] as const;

/** Years that get a labelled tick: round years that fall inside the ruler, about `count` of them. */
export function rulerTicks(startYear: number, endYear = END_YEAR, count = 5): number[] {
  const span = endYear - startYear;
  const wanted = Math.log(span / Math.max(2, count));
  const step = TICK_STEPS.reduce((best, s) => (Math.abs(Math.log(s) - wanted) < Math.abs(Math.log(best) - wanted) ? s : best));
  const ticks: number[] = [];
  // The first and last few years are left bare so a label never sits on the ruler's end.
  for (let y = Math.ceil((startYear + span * 0.04) / step) * step; y <= endYear - span * 0.04; y += step) ticks.push(y);
  return ticks;
}

/** The index in `positions` closest to `x`, for snapping a pointer to a dot. -1 when the list is empty. */
export function nearestIndex(positions: readonly number[], x: number): number {
  let best = -1;
  let bestDistance = Infinity;
  positions.forEach((p, i) => {
    const d = Math.abs(p - x);
    if (d < bestDistance) {
      best = i;
      bestDistance = d;
    }
  });
  return best;
}
