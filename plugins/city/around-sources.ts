import { nearbyContributions, type NearbyContribution } from "../../app/core/nearby";
import { byOrder } from "../../app/core/plugin";
import { DEFAULT_REFRESH_MS, thingSources, thingTypes } from "../../app/core/things";

/** Kinds of thing come after the hand-written providers under Sources, in panel order among themselves. */
const THING_ORDER = 60;

/**
 * Everything "Around me" can ask: the `nearby` providers, and one provider for each kind of thing that names a tab.
 * A kind of thing needs no provider of its own: every source that feeds it on the map feeds it here too.
 */
export function aroundSources(): NearbyContribution[] {
  const sources = thingSources();
  const things = thingTypes().flatMap((type): NearbyContribution[] => {
    const kind = type.nearby;
    if (kind === false) return [];
    const feeding = sources.filter((s) => s.types.includes(type.id));
    if (feeding.length === 0) return [];
    const credits = [...new Set(feeding.flatMap((s) => (s.attribution ? [s.attribution] : [])))];
    return [
      {
        id: `city.things.${type.id}`,
        title: type.title,
        order: THING_ORDER,
        refreshMs: Math.min(...feeding.map((s) => s.refreshMs ?? DEFAULT_REFRESH_MS)),
        ...(credits.length > 0 ? { attribution: credits.join(" · ") } : {}),
        load: () => import("./things-nearby").then((m) => ({ default: m.thingProvider(type, kind) })),
      },
    ];
  });
  return [...nearbyContributions(), ...things].sort(byOrder);
}
