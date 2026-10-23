import type { Glyph } from "../../app/ui";

/** Rail glyph: a dish on its mount, talking to a probe. */
export const glyph = [
  { d: "M4.5 5.5a14 14 0 0 0 14 14M4.5 5.5l14 14" },
  { d: "M8.6 15.4l7-7M2.5 21.5h10M9 18.8v2.7" },
  { circle: [16.8, 7.2, 1.4], fill: true },
  { d: "M19 3.5a5.6 5.6 0 0 1 1.5 5.6M15.2 2.8a8.8 8.8 0 0 1 6 6" },
] satisfies Glyph;
