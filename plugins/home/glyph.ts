import type { Glyph } from "../../app/ui";

/** Rail glyph: a crosshair over where you stand. */
export const glyph = [
  { circle: [12, 12, 6.5] },
  { d: "M12 2.5v4M12 17.5v4M2.5 12h4M17.5 12h4" },
  { circle: [12, 12, 1.4], fill: true },
] satisfies Glyph;
