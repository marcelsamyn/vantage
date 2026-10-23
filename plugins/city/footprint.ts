import { inArea, type LatLon } from "../../shared/geo";

type Position = readonly number[];
type Ring = readonly Position[];

const M_PER_DEG = 111_320;
/** How far a lit copy of a building stands out from the original, so it covers it instead of flickering against it. */
export const SKIN_M = 0.4;

/**
 * The ring pushed out by `metres` on every side, or pulled in when `metres` is negative. Each corner moves along the
 * bisector of its two walls' outward normals, so every wall stays parallel to the original at `metres` from it.
 * Positions are [lon, lat]; the offset is worked out in metres around the first corner, exact enough for a building.
 */
export function growRing(ring: Ring, metres: number): number[][] {
  const [lon0 = 0, lat0 = 0] = ring[0] ?? [];
  const kx = M_PER_DEG * Math.cos((lat0 * Math.PI) / 180);
  const pts = ring.map(([lon = 0, lat = 0]): [number, number] => [(lon - lon0) * kx, (lat - lat0) * M_PER_DEG]);
  const [fx, fy] = pts[0] ?? [0, 0];
  const [lx, ly] = pts.at(-1) ?? [0, 0];
  if (pts.length > 1 && fx === lx && fy === ly) pts.pop();
  const n = pts.length;
  if (n < 3) return ring.map((p) => [...p]);
  const at = (i: number): [number, number] => pts[(i + n) % n] ?? [0, 0];

  // Twice the signed area: positive when the ring runs anticlockwise, with its inside to the left of each wall.
  let area = 0;
  for (let i = 0; i < n; i++) area += at(i)[0] * at(i + 1)[1] - at(i + 1)[0] * at(i)[1];
  const side = area > 0 ? 1 : -1;
  const outward = (a: [number, number], b: [number, number]): [number, number] => {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1;
    return [(side * dy) / len, (-side * dx) / len];
  };

  const grown = pts.map((p, i) => {
    const [ax, ay] = outward(at(i - 1), p);
    const [bx, by] = outward(p, at(i + 1));
    const len = Math.hypot(ax + bx, ay + by);
    // A wall that doubles back on itself has no bisector: step straight out from the first.
    const [ux, uy] = len < 1e-9 ? [ax, ay] : [(ax + bx) / len, (ay + by) / len];
    // Clearing both walls by `metres` takes a longer step at a sharp corner; capped, so a spike does not shoot out.
    const reach = metres / Math.max(ux * ax + uy * ay, 0.25);
    return [lon0 + (p[0] + ux * reach) / kx, lat0 + (p[1] + uy * reach) / M_PER_DEG];
  });
  return [...grown, [...(grown[0] ?? [])]];
}

/** A building part as the map's vector tiles give it: one polygon or many merged into one feature, with its heights. */
export interface BuildingFeature {
  geometry: GeoJSON.Geometry;
  properties: Record<string, unknown>;
}

/** A lit building part: how high its walls rise and where they start, in metres above the ground. */
export interface Solid {
  top: number;
  base: number;
}

const metresOr = (value: unknown, fallback: number): number => (typeof value === "number" && Number.isFinite(value) ? value : fallback);

/**
 * The building parts that stand on `at`, each a solid a little larger than the original. The tiles merge
 * neighbouring buildings of one height into one feature, so only the polygon that holds the point is kept. A part
 * without a height stands 6 m tall, as on the map. A building that crosses a tile edge comes clipped to the tile, so
 * its lit copy ends near that edge.
 */
export function footprintsAt(features: readonly BuildingFeature[], at: LatLon): GeoJSON.FeatureCollection<GeoJSON.Polygon, Solid> {
  const solids: GeoJSON.Feature<GeoJSON.Polygon, Solid>[] = [];
  for (const { geometry, properties } of features) {
    const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.type === "MultiPolygon" ? geometry.coordinates : [];
    const top = metresOr(properties.render_height, 6) + SKIN_M;
    const min = metresOr(properties.render_min_height, 0);
    for (const [outer, ...holes] of polygons) {
      if (!outer || !inArea(at, { type: "Polygon", coordinates: [outer, ...holes] })) continue;
      solids.push({
        type: "Feature",
        properties: { top, base: min > 0 ? Math.max(0, min - SKIN_M) : 0 },
        geometry: { type: "Polygon", coordinates: [growRing(outer, SKIN_M), ...holes.map((hole) => growRing(hole, -SKIN_M))] },
      });
    }
  }
  return { type: "FeatureCollection", features: solids };
}
