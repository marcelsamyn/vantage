import type { Glyph } from "../../app/ui";

/** Rail glyph: a radar arc with a target rising. */
export const glyph = [
  { d: "M3 18.5a9 9 0 0 1 18 0" },
  { d: "M7.5 18.5a4.5 4.5 0 0 1 9 0" },
  { d: "M12 18.5l5-8" },
  { circle: [17.6, 7.4, 1.3], fill: true },
] satisfies Glyph;
