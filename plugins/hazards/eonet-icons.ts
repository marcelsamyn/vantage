import type { EonetCategory } from "./types";

export const ICON_NAMES = ["fire", "storm", "volcano", "ice", "wave", "dust", "sun", "generic"] as const;
export type IconName = (typeof ICON_NAMES)[number];

/** Which icon draws each EONET category. */
export const EONET_ICON: Record<EonetCategory, IconName> = {
  wildfires: "fire",
  severeStorms: "storm",
  volcanoes: "volcano",
  seaLakeIce: "ice",
  floods: "wave",
  dustHaze: "dust",
  drought: "sun",
  landslides: "generic",
  snow: "ice",
  tempExtremes: "sun",
  waterColor: "wave",
  manmade: "generic",
  earthquakes: "generic",
};

const svg = (body: string): string => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" fill="#fff">${body}</svg>`;

/** White silhouettes on a 48 px grid; the map tints them. */
export const EONET_ICON_SVG: Record<IconName, string> = {
  fire: svg('<path d="M25 3c1 9 11 13 11 25a12 12 0 0 1-24 0c0-6 3-10 6-13 0 4 1 6 3 7-1-7 2-14 4-19z"/>'),
  storm: svg('<path d="M24 5a19 19 0 1 0 19 19h-7a12 12 0 1 1-12-12z"/><circle cx="24" cy="24" r="5"/>'),
  volcano: svg('<path d="M3 43 17 20h14l14 23z"/><path d="M19 15c-2-5 3-6 3-12 4 3 8 6 8 12z"/>'),
  ice: svg('<path d="M24 3 35 24l-2 3 6 5-9 13H18L9 32l6-5-2-3z"/>'),
  wave: svg('<path d="M3 24c5-6 9-6 14 0s9 6 14 0 9-6 14 0v8c-5-6-9-6-14 0s-9 6-14 0-9-6-14 0z"/><path d="M3 38c5-6 9-6 14 0s9 6 14 0 9-6 14 0v5H3z"/>'),
  dust: svg('<circle cx="12" cy="16" r="4"/><circle cx="26" cy="12" r="5"/><circle cx="38" cy="22" r="4"/><circle cx="18" cy="30" r="5"/><circle cx="33" cy="36" r="4"/><circle cx="8" cy="38" r="3"/>'),
  sun: svg('<circle cx="24" cy="24" r="9"/><path d="M22 2h4v8h-4zM22 38h4v8h-4zM2 22h8v4H2zM38 22h8v4h-8zM8 8l3-3 6 6-3 3zM31 34l3-3 6 6-3 3zM37 5l3 3-6 6-3-3zM11 31l3 3-6 6-3-3z"/>'),
  generic: svg('<path d="M24 4 44 24 24 44 4 24z"/>'),
};
