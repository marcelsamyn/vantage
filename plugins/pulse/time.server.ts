/** Several feeds stamp local wall-clock time without an offset, or with a wrong one. These helpers read the clock as a zone's. */

function offsetMs(utc: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(utc));
  const get = (t: string): number => Number(parts.find((p) => p.type === t)?.value);
  return Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second")) - Math.floor(utc / 1000) * 1000;
}

/** "2026/10/08 22:38:02" (or with dashes, or a T) read as time in `timeZone`, as epoch ms. Any offset in the text is ignored. */
export function zoned(text: string, timeZone: string): number | null {
  const m = /^(\d{4})[/-](\d{2})[/-](\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(text);
  if (!m) return null;
  const [y, mo, d, h, mi, s] = m.slice(1).map(Number) as [number, number, number, number, number, number];
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  const first = guess - offsetMs(guess, timeZone);
  // Across a daylight-saving change the first guess can be an hour out.
  return guess - offsetMs(first, timeZone);
}

/** The calendar day of an instant in a zone, "2026-10-08". */
export const dayKey = (ms: number, timeZone: string): string => new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
