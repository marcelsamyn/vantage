import * as SunCalc from "suncalc";

export type Daylight = "day" | "twilight" | "night";

export interface SunInfo {
  state: Daylight;
  /** The next sunrise (when it is dark) or sunset (when it is light); null in polar day or night. */
  next: { kind: "sunrise" | "sunset"; at: number } | null;
}

const DAY_MS = 24 * 3_600_000;

/** Whether the Sun is up at a point, and when that next changes. A camera in the dark should say so. */
export function sunInfo(lat: number, lon: number, at: number): SunInfo {
  const altitude = SunCalc.getPosition(new Date(at), lat, lon).altitude;
  const state: Daylight = altitude > -0.833 ? "day" : altitude > -12 ? "twilight" : "night";
  const kind = state === "day" ? "sunset" : "sunrise";
  const upcoming = [-1, 0, 1]
    .map((d) => SunCalc.getTimes(new Date(at + d * DAY_MS), lat, lon)[kind])
    .flatMap((d) => (d && d.getTime() > at ? [d.getTime()] : []))
    .sort((a, b) => a - b)[0];
  return { state, next: upcoming === undefined ? null : { kind, at: upcoming } };
}

/** Clock time at a camera, in its own time zone. */
export function localTime(tz: string, at: number): string {
  return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: tz }).format(at);
}

/** "Night there, sunrise in 4 h 10 min" */
export function sunNote(sun: SunInfo, at: number, until: (ts: number, now: number) => string): string {
  if (!sun.next) return sun.state === "day" ? "Daylight there: the Sun does not set today" : "Night there: the Sun does not rise today";
  const base = sun.state === "day" ? "Daylight there" : sun.state === "twilight" ? "Twilight there" : "Night there";
  return `${base}, ${sun.next.kind} ${until(sun.next.at, at)}`;
}
