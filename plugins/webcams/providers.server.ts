import { distanceM, type LatLon } from "../../shared/geo";
import { directoryProviders } from "./directories.server";
import { remoteProviders } from "./remote.server";
import { streetProviders } from "./traffic.server";
import type { Webcam } from "./types";

export interface CoveredCity {
  name: string;
  lat: number;
  lon: number;
}

/** Where to look: everything within `radiusM` of a point. */
export interface Circle extends LatLon {
  radiusM: number;
}

interface Coverage {
  id: string;
  name: string;
  /** Cities the provider covers. When you are far from every camera, the wall jumps to the nearest of these. */
  cities?: readonly CoveredCity[];
  /** [south, west, north, east] of the area the provider covers. */
  bbox: [number, number, number, number];
}

/** An operator that publishes its whole list. Each loader caches its own list; a call is cheap once warm. */
export interface ListedProvider extends Coverage {
  load: () => Promise<Webcam[]>;
}

/** A directory that answers for one area at a time, such as Windy or OpenStreetMap. */
export interface SearchedProvider extends Coverage {
  /** False while an optional key is missing; the provider then sits out without counting as failed. */
  configured: () => boolean;
  /** Cameras around the point. A directory that caps its answer returns the nearest ones. */
  search: (around: Circle) => Promise<Webcam[]>;
}

/**
 * One source of cameras. To add one, write a provider in `traffic.server.ts` (road operators),
 * `remote.server.ts` (places nobody goes) or `directories.server.ts` (directories searched by area) and add it to
 * that file's list. Only sources that publish cameras for the public to watch belong here. Never cameras found by scanning.
 */
export type WebcamProvider = ListedProvider | SearchedProvider;

/**
 * Cameras for the wall, the map and Around me. Earlier providers win when two list the same picture, so the
 * operators that run the cameras come before the directories that collect them.
 */
export const STREET: readonly WebcamProvider[] = [...streetProviders, ...directoryProviders];
export const REMOTE: readonly ListedProvider[] = remoteProviders;

/** Every covered city with the provider that serves it. */
export const coveredCities = (): { city: CoveredCity; provider: WebcamProvider }[] => STREET.flatMap((provider) => (provider.cities ?? []).map((city) => ({ city, provider })));

/** Distance from a point to the nearest edge of a provider's coverage box; 0 inside it. */
export function distanceToBox(p: LatLon, [s, w, n, e]: Coverage["bbox"]): number {
  return distanceM(p, { lat: Math.min(n, Math.max(s, p.lat)), lon: Math.min(e, Math.max(w, p.lon)) });
}

/** The providers worth asking about a circle: configured, and covering some of it. */
export const covering = (providers: readonly WebcamProvider[], around: Circle): WebcamProvider[] =>
  providers.filter((p) => ("configured" in p ? p.configured() : true) && distanceToBox(around, p.bbox) <= around.radiusM);

/** The cameras one provider has within the circle. */
export async function camerasAround(provider: WebcamProvider, around: Circle): Promise<Webcam[]> {
  const cameras = "load" in provider ? await provider.load() : await provider.search(around);
  return cameras.filter((c) => distanceM(around, c) <= around.radiusM);
}

export interface Gathered {
  cameras: Webcam[];
  /** Names of the providers that did not answer. */
  failed: string[];
}

/** Two listings show the same camera when they show the same picture. The host is case-insensitive; the rest is not. */
function pictureKey(image: string): string {
  const url = new URL(image);
  return `${url.host}${url.pathname}${url.search}`;
}

/**
 * Merge what each provider answered, in provider order. A camera listed twice, by id or by picture, is kept once,
 * from the first provider that listed it. A provider that failed is named, and the others carry on.
 */
export function fuse(providers: readonly { name: string }[], answers: readonly PromiseSettledResult<readonly Webcam[]>[]): Gathered {
  const cameras: Webcam[] = [];
  const seen = new Set<string>();
  const failed: string[] = [];
  answers.forEach((answer, i) => {
    if (answer.status === "rejected") {
      failed.push(providers[i]?.name ?? "provider");
      return;
    }
    for (const camera of answer.value) {
      const picture = pictureKey(camera.image);
      if (seen.has(camera.id) || seen.has(picture)) continue;
      seen.add(camera.id).add(picture);
      cameras.push(camera);
    }
  });
  return { cameras, failed };
}

/** Ask every provider at once and fuse the answers. */
export async function gather<P extends WebcamProvider>(providers: readonly P[], ask: (provider: P) => Promise<readonly Webcam[]>): Promise<Gathered> {
  return fuse(providers, await Promise.allSettled(providers.map(ask)));
}
