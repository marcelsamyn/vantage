import { MAP_INK } from "../city/extension";
import type { GridKind } from "./types";

/**
 * Map badges for street-grid objects: a dark disc with a coloured ring and glyph, so they read on the night map.
 * Colours follow the design semantics: alarm for surveillance, mint for help and health, sodium for
 * infrastructure that broadcasts or carries energy, ice for connectivity, bone for civic buildings.
 */
const GLYPHS: Record<GridKind, string> = {
  camera: '<g transform="rotate(-18 12 12)"><rect x="4" y="8" width="11" height="6" rx="1"/><path d="M15 10l4-2v6l-4-2z"/></g><path d="M9 14.5v4.5H6" fill="none"/>',
  signal: '<rect x="8" y="3" width="8" height="18" rx="2" fill="none"/><circle cx="12" cy="7.5" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="16.5" r="1.6"/>',
  wifi: '<path d="M4 10a11 11 0 0 1 16 0M7 13.2a6.6 6.6 0 0 1 10 0M10 16.4a2.6 2.6 0 0 1 4 0" fill="none"/><circle cx="12" cy="19" r="1.3"/>',
  tower: '<path d="M12 4v17M8.5 21L12 9l3.5 12M7 7.5a7 7 0 0 1 10 0M9.4 9.8a3.6 3.6 0 0 1 5.2 0" fill="none"/>',
  substation: '<path d="M13 3L6 13.5h5.2L10 21l7.5-11h-5.3z"/>',
  powerline: '<path d="M13 3L6 13.5h5.2L10 21l7.5-11h-5.3z"/>',
  police: '<path d="M12 3.5l6.5 2.6v4.8c0 4.5-2.8 7.5-6.5 9.4-3.7-1.9-6.5-4.9-6.5-9.4V6.1z" fill="none"/><path d="M12 8.5l1.1 2.3 2.5.3-1.8 1.7.5 2.5-2.3-1.2-2.3 1.2.5-2.5-1.8-1.7 2.5-.3z"/>',
  fire: '<path d="M12 3c.6 3.2 4.6 5.4 4.6 9.7A4.6 4.6 0 0 1 12 17.4a4.6 4.6 0 0 1-4.6-4.7c0-2.2 1.1-3.6 2.2-4.8.2 1.6.9 2.6 1.9 3.1C11 9 11.3 5.8 12 3z"/><path d="M7 20.5h10" fill="none"/>',
  hospital: '<path d="M10 4.5h4v5.5h5.5v4H14v5.5h-4V14H4.5v-4H10z"/>',
  aed: '<path d="M12 20s-7-4.3-7-9.4A3.9 3.9 0 0 1 12 8.3a3.9 3.9 0 0 1 7 2.3C19 15.7 12 20 12 20z" fill="none"/><path d="M12.6 9.5L10 13.4h2.3L11.4 17l3-4.4h-2.3z"/>',
  water: '<path d="M12 3.5c2.8 3.8 5.6 6.8 5.6 10.4a5.6 5.6 0 0 1-11.2 0c0-3.6 2.8-6.6 5.6-10.4z"/>',
  toilets: '<text x="12" y="16" font-family="Helvetica, Arial, sans-serif" font-size="9.5" font-weight="700" text-anchor="middle" stroke="none">WC</text>',
  ev: '<path d="M9 3.5v4.5M15 3.5v4.5M7 8h10v3.5a5 5 0 0 1-10 0zM12 16.5V21" fill="none"/>',
  station: '<rect x="6.5" y="3.5" width="11" height="13" rx="3" fill="none"/><path d="M6.5 10.5h11M9 20.5l1.6-3.4M15 20.5l-1.6-3.4" fill="none"/><circle cx="9.4" cy="13.6" r="1"/><circle cx="14.6" cy="13.6" r="1"/>',
  bridge: '<path d="M3 16.5h18M5 16.5v-3.5a7 7 0 0 1 14 0v3.5M9 10.6v5.9M15 10.6v5.9" fill="none"/>',
};

export const GRID_COLOR: Record<GridKind, string> = {
  camera: MAP_INK.alarm,
  signal: MAP_INK.bone,
  wifi: MAP_INK.ice,
  tower: MAP_INK.sodium,
  substation: MAP_INK.sodium,
  powerline: MAP_INK.sodium,
  police: MAP_INK.bone,
  fire: MAP_INK.alarm,
  hospital: MAP_INK.mint,
  aed: MAP_INK.mint,
  water: MAP_INK.ice,
  toilets: MAP_INK.fog,
  ev: MAP_INK.mint,
  station: MAP_INK.bone,
  bridge: MAP_INK.sodium,
};

/** Full SVG for a badge, 32×32. */
export function badgeSvg(kind: GridKind): string {
  const c = GRID_COLOR[kind];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><circle cx="16" cy="16" r="13.5" fill="${MAP_INK.void}" fill-opacity="0.92" stroke="${c}" stroke-width="1.6"/><g transform="translate(5.6 5.6) scale(0.87)" fill="${c}" stroke="${c}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${GLYPHS[kind]}</g></svg>`;
}

export const iconName = (kind: GridKind): string => `grid-${kind}`;

/**
 * One glyph on its own, in white, for a map icon drawn inside a ring the layer colours. The badge above draws
 * its own disc and ring; a thing on the map gets those from its type's tone.
 */
export const markSvg = (kind: GridKind): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#fff" stroke="#fff" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${GLYPHS[kind]}</svg>`;
