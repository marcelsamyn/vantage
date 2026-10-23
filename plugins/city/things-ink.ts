import type { ThingState, ThingTone } from "../../app/core/things";
import { MAP_INK } from "./layer-kit";

/** A thing type's tone as a colour the map can paint. */
export const TONE_INK: Record<ThingTone, string> = {
  ice: MAP_INK.ice,
  mint: MAP_INK.mint,
  sodium: MAP_INK.sodium,
  alarm: MAP_INK.alarm,
  bone: MAP_INK.bone,
  fog: MAP_INK.fog,
};

/**
 * The colour of one thing: its type's tone, unless a source reports it running low (sodium) or out (alarm).
 * A source that knows nothing about its state leaves the type's own colour alone.
 */
export function thingInk(tone: ThingTone, state: ThingState): string {
  if (state === "out") return MAP_INK.alarm;
  if (state === "low") return MAP_INK.sodium;
  return TONE_INK[tone];
}

/** The map image name of a type's icon, or of one of its variants. */
export const thingIconName = (type: string, variant?: string | null): string => (variant ? `thing-${type}/${variant}` : `thing-${type}`);
