import type { BandReach, CosmicRays, FieldInfo, IonosphereInfo } from "./types";

export interface ShieldsStatus {
  /** `quiet`: nothing unusual. `unsettled`: the field is restless. `disturbed`: cosmic rays are down or the field is in storm. */
  tone: "quiet" | "unsettled" | "disturbed";
  /** One line for all three layers, e.g. "Quiet: cosmic rays normal, field calm, 30 m band open from 1,870 km". */
  line: string;
}

/** The highest-frequency band that bounces, which is the one that carries furthest. */
export function topOpenBand(bands: readonly BandReach[]): BandReach | null {
  return bands.filter((b) => b.state !== "closed").sort((a, b) => b.mhz - a.mhz)[0] ?? null;
}

/** Round to the nearest 10 km: the figures come from a model, so the last digit says nothing. */
export const roundKm = (km: number): number => Math.round(km / 10) * 10;

/**
 * Combine the three layers into one line. A layer that failed to load drops out of the line instead of
 * pretending to be fine. `formatKm` turns kilometres into the viewer's units.
 */
export function shieldsStatus(layers: { cosmic: CosmicRays | null; field: FieldInfo | null; sky: IonosphereInfo | null }, formatKm: (km: number) => string): ShieldsStatus | null {
  const parts: string[] = [];
  let tone: ShieldsStatus["tone"] = "quiet";

  const { cosmic, field, sky } = layers;
  if (cosmic) {
    const fall = cosmic.forbush?.ongoing ? cosmic.forbush : null;
    parts.push(fall ? `cosmic rays down ${fall.depthPct.toFixed(0)} %` : "cosmic rays normal");
    if (fall) tone = "disturbed";
  }
  if (field) {
    parts.push(`field ${field.level}`);
    if (field.level === "storm" || field.level === "active") tone = "disturbed";
    else if (field.level === "unsettled" && tone === "quiet") tone = "unsettled";
  }
  if (sky) {
    const band = topOpenBand(sky.bands);
    if (!band) parts.push("no shortwave band bounces");
    else parts.push(band.state === "near" ? `${band.name} band open at any distance` : `${band.name} band open from ${formatKm(roundKm(band.fromKm))}`);
  }
  if (parts.length === 0) return null;
  const head = tone === "quiet" ? "Quiet" : tone === "unsettled" ? "Unsettled" : "Disturbed";
  return { tone, line: `${head}: ${parts.join(", ")}` };
}
