import type { Glyph } from "../../app/ui";

/** Rail glyph: a security camera. */
export const glyph = [
  { d: "M3 6.5h13v7.5H3z" },
  { d: "M16 9l5-2.5V14L16 11.5" },
  { d: "M9.5 14v4H3.5M3.5 15.5v6" },
  { circle: [7, 10.2, 1.3], fill: true },
] satisfies Glyph;
