import { distanceWords, lightTimeWords, type UnitSystem } from "./physics";
import type { DsnLink } from "./types";

/** Two readings of the same distance this close count as a tie. */
const TIE = 0.005;

/**
 * The link to feature: the one reaching farthest from Earth. Several complexes can hear the same spacecraft at once
 * (their distances then agree to within rounding), and Madrid wins that tie because it faces the user's side of the world.
 */
export function farthestLink(links: readonly DsnLink[]): DsnLink | null {
  const measured = links.filter((l): l is DsnLink & { distanceKm: number } => l.distanceKm !== null);
  const farthest = Math.max(0, ...measured.map((l) => l.distanceKm));
  if (farthest === 0) return null;
  const tied = measured.filter((l) => l.distanceKm >= farthest * (1 - TIE));
  return tied.find((l) => l.complexId === "mdscc") ?? tied.sort((a, b) => b.distanceKm - a.distanceKm)[0] ?? null;
}

export const isTalking = (link: DsnLink): boolean => link.uplinks.length > 0;

/** "Madrid is listening to Voyager 1, 25.8 billion km away." */
export function linkClause(link: DsnLink, complexName: string, units: UnitSystem): string {
  const verb = isTalking(link) ? "talking to" : "listening to";
  const away = link.distanceKm === null ? "" : `, ${distanceWords(link.distanceKm, units)} away`;
  return `${complexName} is ${verb} ${link.spacecraft.name}${away}.`;
}

/** "Its signal left 23 h 54 min ago." */
export const signalLeftSentence = (link: DsnLink): string | null => (link.lightSeconds === null ? null : `Its signal left ${lightTimeWords(link.lightSeconds)} ago.`);
