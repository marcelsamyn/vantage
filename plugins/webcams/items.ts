import { fmt } from "../../app/core/format";
import type { Units } from "../../app/core/settings";
import { bearingDeg, compassPoint, distanceM, type LatLon } from "../../shared/geo";
import type { FocusItem } from "./Focus";
import { localTime, sunInfo, sunNote } from "./sky";
import type { CameraKind, OrbitFrame, Webcam } from "./types";

export const KIND_LABEL: Record<CameraKind, string> = {
  traffic: "Traffic",
  weather: "Road weather",
  view: "Viewpoint",
  volcano: "Volcano",
  ocean: "Ocean buoy",
  polar: "Polar station",
  observatory: "Observatory",
  sky: "Aurora and sky",
};

/**
 * A small number that depends only on the camera's key. Tiles use it to stagger their entrance and first load, so a
 * tile keeps its delay when the gallery re-sorts and the page does not fetch the same picture again.
 */
export function staggerSlot(key: string, slots: number): number {
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  return hash % slots;
}

/** "windy.com" for a camera page, to name where a link goes. */
export const siteOf = (page: string): string => new URL(page).hostname.replace(/^www\./, "");

const utcStamp = (ms: number): string => `${new Date(ms).toISOString().slice(0, 16).replace("T", " ")} UTC`;

/** "420 m NE" from a point to a camera. */
export function fromPoint(origin: LatLon, c: Webcam, units: Units): string {
  return `${fmt.distance(distanceM(origin, c), units)} ${compassPoint(bearingDeg(origin, c))}`;
}

/** A public camera this close to a mapped surveillance camera is worth showing in that camera's profile. */
export const CLOSE_M = 30;

export interface PublicPicture {
  camera: Webcam;
  distanceM: number;
  /** Both records point to one OpenStreetMap object: the surveillance camera itself publishes this picture. */
  same: boolean;
}

/**
 * The public camera to show for a surveillance camera mapped as `osm` ("node/123"): its own picture when both records
 * point to that object, otherwise the nearest public camera within CLOSE_M.
 */
export function publicPicture(cameras: readonly Webcam[], at: LatLon, osm: string): PublicPicture | null {
  const own = cameras.find((c) => c.id === `osm:${osm}`);
  if (own) return { camera: own, distanceM: distanceM(at, own), same: true };
  let best: PublicPicture | null = null;
  for (const camera of cameras) {
    const d = distanceM(at, camera);
    if (d <= CLOSE_M && (best === null || d < best.distanceM)) best = { camera, distanceM: d, same: false };
  }
  return best;
}

/** The darkness notice for a remote camera, or null when nothing needs saying. */
export function darkNote(c: Webcam, now: number): string | null {
  const sun = sunInfo(c.lat, c.lon, now);
  if (c.kind === "sky") return sun.state === "day" ? "Daylight there. This camera is built for dark skies." : null;
  return sun.state === "day" ? null : sunNote(sun, now, fmt.until);
}

export function cameraItem(c: Webcam, origin: LatLon | null, units: Units, now: number): FocusItem {
  const remote = c.tz !== null;
  const sun = remote ? sunInfo(c.lat, c.lon, now) : null;
  return {
    key: c.id,
    eyebrow: KIND_LABEL[c.kind],
    title: c.name,
    subtitle: c.providerName,
    src: c.image,
    refreshS: c.refreshS,
    frames: c.frames,
    stream: c.stream,
    note: remote ? darkNote(c, now) : null,
    license: c.license,
    camera: c,
    rows: [
      c.direction && ["Facing", c.direction],
      origin && !remote && ["From the wall centre", fromPoint(origin, c, units)],
      c.tz && ["Local time", `${localTime(c.tz, now)}${sun ? ` · ${sun.state === "day" ? "day" : sun.state === "twilight" ? "twilight" : "night"}` : ""}`],
      ["Position", fmt.coord(c.lat, c.lon)],
      ["Refreshes", `every ${fmt.duration(c.refreshS)}`],
      c.capturedAt !== null && ["Picture taken", utcStamp(c.capturedAt)],
      c.stream && ["Video", "Live stream from the operator"],
    ],
  };
}

export function orbitItem(f: OrbitFrame, now: number): FocusItem {
  return {
    key: f.id,
    eyebrow: f.subject === "sun" ? "The Sun" : "Earth from space",
    title: f.title,
    subtitle: f.craft,
    src: f.imageLarge,
    refreshS: f.refreshS,
    square: true,
    about: f.about,
    license: f.license,
    rows: [
      ["Spacecraft", `${f.craft} · ${f.operator}`],
      ["Vantage point", f.vantage],
      f.capturedAt !== null && ["Taken", `${utcStamp(f.capturedAt)} · ${fmt.ago(f.capturedAt, now)}`],
      ["Refreshes", `about every ${fmt.duration(f.refreshS)}`],
    ],
  };
}
