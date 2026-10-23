import type { NearbyIcon, NearbyItem, NearbyKind, NearbyProvider, NearbyTone } from "../../app/core/nearby";
import { fuseThings, thingActions, thingSources, type FusedThing, type Thing, type ThingQuery, type ThingState, type ThingTone, type ThingTypeContribution } from "../../app/core/things";
import { distanceM, type LatLon } from "../../shared/geo";
import { AROUND_ZOOM } from "./around";
import { useCity } from "./store";

/**
 * A kind of thing as an "Around me" provider. It asks the same sources the map asks, merges their reports the same
 * way, and lists the nearest few, so a city's own dataset shows up here the moment it feeds the map.
 */

/** Things worth walking to: past this, the street-grid tiles a source loads would cover a whole district. */
const REACH_M = 1000;
/** The nearest few of each kind; the map shows the rest. */
const PER_KIND = 3;
/**
 * How long to wait for the slowest source. One slow survey must not hold back what the others found, and Around me
 * counts a provider as failed after 30 s.
 */
const PATIENCE_MS = 20_000;

export interface KindIcons {
  icon: NearbyIcon;
  variants: Readonly<Record<string, NearbyIcon>>;
}

/** The map's colours in Around me's words: ice marks you there, and bone has no place in the list. */
function toneOf(tone: ThingTone, state: ThingState): NearbyTone {
  if (state === "out") return "alarm";
  if (state === "low") return "sodium";
  return tone === "ice" || tone === "bone" ? "fog" : tone;
}

/** The nearest things within reach, as items. Exported on its own, so a test can feed it merged things. */
export function thingItems(things: readonly FusedThing[], type: ThingTypeContribution, kind: NearbyKind, icons: KindIcons, at: LatLon, reachM: number): NearbyItem[] {
  return things
    .map((t) => ({ t, d: distanceM(at, t.at) }))
    .filter((x) => x.d <= reachM)
    .sort((a, b) => a.d - b.d)
    .slice(0, PER_KIND)
    .map(({ t }): NearbyItem => {
      const more = thingActions(t);
      return {
        id: t.key,
        title: t.name,
        detail: t.detail ?? type.title,
        kind,
        at: t.at,
        icon: (t.variant !== null ? icons.variants[t.variant] : undefined) ?? icons.icon,
        tone: toneOf(type.tone, t.state),
        ...(t.image !== null ? { image: t.image } : {}),
        entity: { kind: "thing", id: t.key, data: t },
        primary: { label: "Walk there", run: () => import("./client").then((m) => m.routeTo({ ...t.at, name: t.name }, "foot")) },
        ...(more.length > 0 ? { more } : {}),
      };
    });
}

async function loadIcons(type: ThingTypeContribution): Promise<KindIcons> {
  const [icon, variants] = await Promise.all([type.icon(), Promise.all(Object.entries(type.variants ?? {}).map(async ([name, load]) => [name, await load()] as const))]);
  return { icon, variants: Object.fromEntries(variants) };
}

export function thingProvider(type: ThingTypeContribution, kind: NearbyKind): NearbyProvider {
  return async ({ at, radiusM, now }, signal) => {
    const reach = Math.min(radiusM, REACH_M);
    const dLat = reach / 111_320;
    const dLon = reach / (111_320 * Math.cos((at.lat * Math.PI) / 180));
    // The zoom a map showing this reach would have, so a source that answers per area keeps to its own floor.
    const zoom = AROUND_ZOOM + Math.log2(1000 / reach);
    const query: ThingQuery = { box: { west: at.lon - dLon, south: at.lat - dLat, east: at.lon + dLon, north: at.lat + dLat }, center: at, zoom, types: [type.id], now };
    // A source switched off on the map stays off here.
    const muted = new Set(useCity.getState().mutedSources);
    const sources = thingSources().filter((s) => s.types.includes(type.id) && !muted.has(s.id) && zoom >= (s.minZoom ?? 0));

    const found = new Map<string, readonly Thing[]>();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const patience = new Promise<"late">((resolve) => (timer = setTimeout(() => resolve("late"), PATIENCE_MS)));
    const asked = Promise.allSettled(sources.map(async (s) => (await s.load()).default(query, (things) => found.set(s.id, things), signal)));
    const [icons, settled] = await Promise.all([loadIcons(type), Promise.race([asked, patience])]).finally(() => clearTimeout(timer));
    // A source that failed or is still working after reporting part of its answer counts; only silence everywhere fails.
    if (found.size === 0) {
      if (settled === "late") throw new Error(`No answer within ${PATIENCE_MS / 1000} s`);
      const failure = settled.find((r): r is PromiseRejectedResult => r.status === "rejected");
      if (failure) throw failure.reason;
    }

    const batches = sources.flatMap((source) => {
      const things = found.get(source.id);
      return things ? [{ source, things }] : [];
    });
    return thingItems(fuseThings(batches, [type]), type, kind, icons, at, reach);
  };
}
