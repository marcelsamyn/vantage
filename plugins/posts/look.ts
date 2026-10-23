import { MAP_INK } from "../city/extension";
import type { LifeGroup, ReportCategory, ReportStatus } from "./types";

/**
 * How posts look on the map. VANTAGE has a fixed palette, so six life groups share three inks and differ by
 * fill: a solid dot or a ring.
 */
export const GROUP_LOOK: Record<LifeGroup, { label: string; ink: string; hollow: boolean }> = {
  plants: { label: "Plants", ink: MAP_INK.mint, hollow: false },
  fungi: { label: "Fungi and lichens", ink: MAP_INK.mint, hollow: true },
  birds: { label: "Birds", ink: MAP_INK.sodium, hollow: false },
  vertebrates: { label: "Mammals, reptiles, amphibians and fish", ink: MAP_INK.sodium, hollow: true },
  invertebrates: { label: "Insects, spiders, snails and kin", ink: MAP_INK.fog, hollow: false },
  other: { label: "Other life", ink: MAP_INK.fog, hollow: true },
};

/** Flickr photos wear a bone ring, like a print's white border. */
export const PHOTO_INK = MAP_INK.bone;

export const STATUS_LOOK: Record<ReportStatus, { label: string; ink: string }> = {
  new: { label: "New", ink: MAP_INK.sodium },
  progress: { label: "In progress", ink: MAP_INK.bone },
  closed: { label: "Closed", ink: MAP_INK.mint },
};

/** Report pictograms as filled silhouettes on a 24 px grid; the map tints them by status. */
const SHAPES: Record<ReportCategory, string> = {
  // A traffic cone: works and damage on the road.
  roads: '<path d="M10.2 3.5h3.6l4.4 14.5H5.8z"/><path d="M4 18.5h16v2.5H4z"/>',
  // A street bin with its lid.
  cleanliness: '<path d="M10 3h4v2h-4z"/><path d="M5.5 5.5h13v2.5h-13z"/><path d="M7 9h10l-1 12H8z"/>',
  nature: '<circle cx="12" cy="9" r="6.5"/><path d="M10.8 13h2.4v8.5h-2.4z"/>',
  signs: '<path d="M12 2.5l8 13.5H4z"/><path d="M10.8 16h2.4v5.5h-2.4z"/>',
  lighting: '<path d="M6 3.5h12l-2.5 5h-7z"/><path d="M10.8 8h2.4v13.5h-2.4z"/>',
  furniture: '<path d="M3.5 7.5h17v3h-17z"/><path d="M3.5 12h17v2.5h-17z"/><path d="M5 14h2.5v6H5zM16.5 14H19v6h-2.5z"/>',
  monuments: '<path d="M10.5 2.5h3l1.8 15.5H8.7z"/><path d="M6.5 18.5h11V21h-11z"/>',
  vehicles: '<path d="M6.5 6h11l2.2 5.5H21V17H3v-5.5h1.3z"/><circle cx="7.5" cy="17.5" r="2.5"/><circle cx="16.5" cy="17.5" r="2.5"/>',
  other: '<path d="M12 3l8 9-8 9-8-9z"/>',
};

export const reportIcon = (category: ReportCategory): string => `posts-report-${category}`;
export const reportSvg = (category: ReportCategory): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="48" height="48" fill="#fff">${SHAPES[category]}</svg>`;
export const REPORT_CATEGORIES: readonly ReportCategory[] = ["roads", "cleanliness", "nature", "signs", "lighting", "furniture", "monuments", "vehicles", "other"];

/**
 * Opacity for a post's age: the newest is brightest, and a post fades toward a quarter as it nears the end of its
 * window. Give the age and the window in the same unit.
 */
export function fadeFor(age: number, window: number): number {
  const t = Math.min(1, Math.max(0, age / window));
  return Math.round((1 - 0.75 * t) * 100) / 100;
}
