import type { Action } from "../../app/core/action";
import type { Thing, ThingProvider } from "../../app/core/things";
import { osmId } from "../../shared/thing-ids";
import { loadTile, tilesFor } from "./client";
import { DESCRIBE, address, describeRows } from "./describe";
import type { GridFeature, GridKind, GridRef } from "./types";

/**
 * OpenStreetMap as a source of things on the map. One tile answers for every kind at once, so a street with
 * a fountain, a toilet and a defibrillator costs one request, and the tiles are shared with the layers that
 * draw cameras, signals and the power grid.
 *
 * The things carry their OpenStreetMap reference in `match`, so another source built on the same survey —
 * Rome's nasoni, for one — lands on the same thing instead of a second marker beside it. They carry the codes their
 * tags give in other registers too (Wikidata, station and charge point codes), so a city's or an operator's own
 * list finds them without guessing from the position.
 */

/** Which declared type each mapped kind feeds. The kinds left out are drawn by layers of their own. */
const TYPE_OF: Partial<Record<GridKind, string>> = {
  wifi: "wifi",
  tower: "tower",
  bridge: "bridge",
  police: "emergency",
  fire: "emergency",
  hospital: "emergency",
  aed: "aed",
  water: "water",
  toilets: "toilets",
  ev: "ev",
  station: "station",
};

/** One switch covers the three emergency services, so each thing names the mark it should wear. */
const VARIANT: Partial<Record<GridKind, string>> = { police: "police", fire: "fire", hospital: "hospital" };

/** Everything anyone can do about a mapped object: read its record, correct it, or visit whoever runs it. */
function actionsFor(ref: GridRef): Action[] {
  const [kind, id] = ref.osm.split("/");
  const out: Action[] = [{ label: "Open in OpenStreetMap", href: `https://www.openstreetmap.org/${ref.osm}` }];
  if (kind && id) out.push({ label: "Fix in OpenStreetMap", href: `https://www.openstreetmap.org/edit?${kind}=${id}#map=19/${ref.lat.toFixed(5)}/${ref.lon.toFixed(5)}` });
  // Checked by the server with `webUrl`: a tag is whatever a mapper typed.
  if (ref.web) out.push({ label: "Open its website", href: ref.web });
  return out;
}

/** The things of the wanted types among mapped features. Exported on its own so a test can feed it recorded tiles. */
export function gridThings(features: readonly GridFeature[], wanted: ReadonlySet<string>): Thing[] {
  const out: Thing[] = [];
  for (const f of features) {
    const type = TYPE_OF[f.properties.kind];
    if (!type || !wanted.has(type) || f.geometry.type !== "Point") continue;
    const [lon, lat] = f.geometry.coordinates;
    if (lon === undefined || lat === undefined) continue;
    const ref: GridRef = { ...f.properties, lat, lon };
    const described = DESCRIBE[f.properties.kind];
    const variant = VARIANT[f.properties.kind];
    const detail = address(f.properties.tags);
    out.push({
      id: f.properties.osm,
      type,
      name: f.properties.name,
      label: described.fallbackName,
      at: { lat, lon },
      match: [osmId(f.properties.osm), ...f.properties.ids],
      rows: describeRows(f.properties.kind, ref),
      fact: described.fact(f.properties.tags, ref),
      actions: actionsFor(ref),
      ...(variant ? { variant } : {}),
      ...(detail ? { detail } : {}),
    });
  }
  return out;
}

/** Tiles arrive nearest first, and each one adds its things, so the map fills from the middle outward. */
const grid: ThingProvider = async ({ box, types }, emit, signal) => {
  const wanted = new Set(types);
  const tiles = tilesFor(box);
  const byTile = new Map<string, Thing[]>();
  const answers = await Promise.allSettled(
    tiles.map(async (t) => {
      const tile = await loadTile(t.x, t.y);
      if (signal.aborted) return;
      byTile.set(`${t.x}/${t.y}`, gridThings(tile.features, wanted));
      emit([...byTile.values()].flat());
    }),
  );
  // One tile that Overpass refused leaves the rest on the map; every tile failing is worth saying.
  const failed = answers.flatMap((a) => (a.status === "rejected" ? [a.reason] : []));
  if (failed.length === tiles.length && tiles.length > 0) throw failed[0] instanceof Error ? failed[0] : new Error(String(failed[0]));
};

export default grid;
