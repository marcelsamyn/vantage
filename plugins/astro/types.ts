/** Entity data for things in the sky that are not machines. */
export interface BodyRef {
  body: "sun" | "moon" | "star";
  name: string;
  /** For stars: right ascension in hours, declination in degrees, apparent magnitude. */
  raH?: number;
  decDeg?: number;
  mag?: number;
}

declare module "../../app/core/plugin" {
  interface EntityKinds {
    body: BodyRef;
  }
}
