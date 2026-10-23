/**
 * Calendar dates for sources that publish a date and no time. A date names a day in the source's own time zone,
 * so "today" and "yesterday" are counted there, never in UTC, and no time of day is ever made up.
 */

const DAY_MS = 86_400_000;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export const isDateOnly = (value: string): boolean => DATE.test(value);

/** The calendar date (YYYY-MM-DD) at `now` in a time zone. */
export function dateIn(timeZone: string, now: number): string {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes): string => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function dayNumber(date: string): number {
  const m = DATE.exec(date);
  if (!m) throw new RangeError(`Not a calendar date: ${date}`);
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / DAY_MS;
}

/** Whole days from `from` to `to`; positive when `to` is later. */
export const daysBetween = (from: string, to: string): number => dayNumber(to) - dayNumber(from);

export function addDays(date: string, days: number): string {
  return new Date((dayNumber(date) + days) * DAY_MS).toISOString().slice(0, 10);
}

/** "today", "yesterday" or "3 days ago", counted from `today`. A date after `today` (a clock running ahead) reads "today". */
export function dayLabel(date: string, today: string): string {
  const n = daysBetween(date, today);
  if (n <= 0) return "today";
  if (n === 1) return "yesterday";
  return `${n} days ago`;
}
