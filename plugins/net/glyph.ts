import type { Glyph } from "../../app/ui";

/** Rail glyph: three linked nodes. */
export const glyph = [
  { circle: [5, 6, 2] },
  { circle: [19, 6, 2] },
  { circle: [12, 18, 2] },
  { d: "M7 6h10M6.1 7.8l4.8 8.4M17.9 7.8l-4.8 8.4" },
] satisfies Glyph;
