import type { Glyph } from "../../app/ui";

/** Rail glyph: a signal reaching out. */
export const glyph = [
  { circle: [5.5, 18.5, 1.6], fill: true },
  { d: "M5.5 12.5a6 6 0 0 1 6 6M5.5 7a11.5 11.5 0 0 1 11.5 11.5" },
  { d: "M15.5 3.5h5v5M20.5 3.5l-6 6" },
] satisfies Glyph;
