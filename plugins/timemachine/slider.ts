/** Keyboard steps of the divider, as fractions of the map width. */
const KEY_STEP = 0.02;
const PAGE_STEP = 0.1;
/** The divider stays this far from either edge so it can always be grabbed again. */
export const EDGE = 0.04;

export const clampSplit = (v: number): number => Math.min(1 - EDGE, Math.max(EDGE, v));

/** Where the divider goes for a key press, or null for keys the slider ignores. Home and End go to the clamped edges. */
export function splitForKey(key: string, current: number): number | null {
  switch (key) {
    case "ArrowLeft":
      return clampSplit(current - KEY_STEP);
    case "ArrowRight":
      return clampSplit(current + KEY_STEP);
    case "PageDown":
      return clampSplit(current - PAGE_STEP);
    case "PageUp":
      return clampSplit(current + PAGE_STEP);
    case "Home":
      return clampSplit(0);
    case "End":
      return clampSplit(1);
    default:
      return null;
  }
}

/** The left side shows the past and the right side today, so the divider's position is the share of each. */
export const splitText = (split: number): string => `${Math.round(split * 100)} % then, ${100 - Math.round(split * 100)} % now`;
