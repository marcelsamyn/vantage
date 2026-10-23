import { fmt } from "../../app/core/format";
import type { Units } from "../../app/core/settings";
import type { TrafficEvent } from "./types";
export function trafficRows(
  event: TrafficEvent,
  units: Units,
): [string, string][] {
  const timestamp = (value: number | null): string =>
    value === null ? "Unknown" : new Date(value).toLocaleString();
  const rows: [string, string][] = [
    ["Report", event.id],
    ["Status", event.status],
    ["Category", event.category],
    ["Severity", event.severity],
    ["Description", event.description],
    ["Starts", timestamp(event.startsAt)],
    ["Ends", timestamp(event.endsAt)],
    ["Updated", timestamp(event.updatedAt)],
  ];
  if (event.lengthM !== undefined)
    rows.push(["Length", fmt.distance(event.lengthM, units)]);
  rows.push(...event.rows);
  return rows.filter(([, value]) => Boolean(value));
}
