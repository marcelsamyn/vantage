import { AU_KM, LIGHT_KM_S } from "./physics";
import type { SystemBody } from "./types";

/** The orrery is drawn in a square of this many units; the Sun sits at the middle. */
export const SIZE = 1000;
export const CENTER = SIZE / 2;
/** Outermost drawn radius, leaving room for labels at the edge. */
const OUTER = 440;

export type ScaleMode = "system" | "inner";

export interface Ring {
  au: number;
  label: string;
  /** Marks the distance light travels in a day: Voyager 1 is about to cross it. */
  lightDay?: boolean;
}

export interface Scale {
  mode: ScaleMode;
  /** Drawn radius for a distance from the Sun in AU. */
  radius: (au: number) => number;
  /** Distances beyond this are not drawn. */
  maxAu: number;
  rings: Ring[];
}

/** Jupiter's orbit. Inside it the scale is linear, so the planets keep their proportions; beyond it, logarithmic, so Voyager fits. */
const LINEAR_UNTIL_AU = 5.5;
const INNER_MAX_AU = 2;
/** Share of the drawn radius taken by everything inside Jupiter's orbit. */
const KNEE_SHARE = 0.36;
export const LIGHT_DAY_AU = (LIGHT_KM_S * 86_400) / AU_KM;

export function makeScale(mode: ScaleMode, farthestAu: number): Scale {
  if (mode === "inner") {
    return {
      mode,
      radius: (au) => (au / INNER_MAX_AU) * OUTER,
      maxAu: INNER_MAX_AU * 1.02,
      rings: [0.5, 1, 1.5, 2].map((au) => ({ au, label: `${au} AU` })),
    };
  }
  const maxAu = Math.max(farthestAu * 1.04, 40);
  // The inner planets get a third of the radius so they stay readable; beyond Jupiter each doubling of distance adds the same step.
  const kneeRadius = OUTER * KNEE_SHARE;
  const logStep = (OUTER - kneeRadius) / Math.log(maxAu / LINEAR_UNTIL_AU);
  const radius = (au: number): number => (au <= LINEAR_UNTIL_AU ? (au / LINEAR_UNTIL_AU) * kneeRadius : kneeRadius + logStep * Math.log(au / LINEAR_UNTIL_AU));
  const rings: Ring[] = [1, 5, 10, 30, 100].map((au) => ({ au, label: `${au} AU` }));
  if (LIGHT_DAY_AU < maxAu) rings.push({ au: LIGHT_DAY_AU, label: "1 light-day", lightDay: true });
  return { mode, radius, maxAu, rings };
}

export interface Placed {
  x: number;
  y: number;
  /** Position as a percentage of the square, for HTML overlays. */
  left: number;
  top: number;
}

/**
 * Where a body is drawn. The radius is its true distance from the Sun; the angle is its ecliptic longitude,
 * seen from above the north pole of the ecliptic (planets orbit counterclockwise). A spacecraft far above or below
 * the plane, like Voyager 1, is therefore placed by its distance and its bearing, not by its shadow on the plane.
 */
export function place(body: SystemBody, scale: Scale): Placed | null {
  const au = body.distSunKm / AU_KM;
  if (au > scale.maxAu) return null;
  const r = scale.radius(au);
  const angle = Math.atan2(body.pos[1], body.pos[0]);
  const x = CENTER + r * Math.cos(angle);
  const y = CENTER - r * Math.sin(angle);
  return { x, y, left: (x / SIZE) * 100, top: (y / SIZE) * 100 };
}

/** Degrees north (positive) or south of the plane of Earth's orbit. */
export const eclipticLatitudeDeg = (body: SystemBody): number => (Math.asin(body.pos[2] / body.distSunKm) * 180) / Math.PI;
