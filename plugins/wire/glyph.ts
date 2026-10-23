import type { Glyph } from "../../app/ui";

/** Rail glyph: a cable between three points. */
export const glyph = [
  { d: "M3.5 18.5c4.2 0 4-12.5 8.5-12.5s4.3 12.5 8.5 12.5" },
  { circle: [3.5, 18.5, 1.6], fill: true },
  { circle: [12, 6, 1.6], fill: true },
  { circle: [20.5, 18.5, 1.6], fill: true },
] satisfies Glyph;
