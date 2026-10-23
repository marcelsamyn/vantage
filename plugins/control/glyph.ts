import type { Glyph } from "../../app/ui";

/** Rail glyph: a dial. */
export const glyph = [
  { circle: [12, 14, 6.5] },
  { d: "M12 14l3.2-3.2" },
  { d: "M1.5 14h2M4.6 6.6l1.4 1.4M12 3.5v2M19.4 6.6L18 8M20.5 14h2" },
  { circle: [12, 14, 1.3], fill: true },
] satisfies Glyph;
