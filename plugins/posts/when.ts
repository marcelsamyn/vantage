import { fmt } from "../../app/core/format";
import { dateIn, dayLabel, isDateOnly } from "./days";

const DAY = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const FULL = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
const HAS_ZONE = /(?:[zZ]|[+-]\d\d:?\d\d)$/;

/**
 * A post's time in words, never more precise than the source:
 * a date reads "yesterday · 8 Oct" (counted in `zone`), a camera's wall-clock time reads "1 Oct, 10:00 local time",
 * a recent instant reads "12m ago · 07:42", and an older one "26 Jun 2024, 10:11".
 */
export function describeWhen(value: string, now: number, zone: string = Intl.DateTimeFormat().resolvedOptions().timeZone): string {
  if (isDateOnly(value)) return `${dayLabel(value, dateIn(zone, now))} · ${DAY.format(Date.parse(value))}`;
  if (!HAS_ZONE.test(value)) {
    const [date = "", time = ""] = value.split("T");
    return isDateOnly(date) ? `${DAY.format(Date.parse(date))}, ${time.slice(0, 5)} local time` : value;
  }
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return value;
  return now - ms < 2 * 86_400_000 ? `${fmt.ago(ms, now)} · ${fmt.clock(ms)}` : FULL.format(ms);
}
