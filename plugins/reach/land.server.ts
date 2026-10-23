import { diskMemo, fetchJson, z } from "../../server/kit";
import type { LandGrid } from "./types";

const SOURCE = "Natural Earth land (world-atlas)";
const URL_110M = "https://cdn.jsdelivr.net/npm/world-atlas@2/land-110m.json";
const STEP_DEG = 2;

const geometry = z.object({ type: z.enum(["Polygon", "MultiPolygon"]), arcs: z.unknown() });
const topology = z.object({
  transform: z.object({ scale: z.tuple([z.number(), z.number()]), translate: z.tuple([z.number(), z.number()]) }),
  arcs: z.array(z.array(z.tuple([z.number(), z.number()]))),
  objects: z.object({ land: z.object({ geometries: z.array(geometry) }) }),
});
type Topology = z.infer<typeof topology>;
type Ring = [number, number][];

/** TopoJSON stores each arc as quantised steps; walk them to get degrees. */
function decodeArcs(t: Topology): Ring[] {
  const { scale, translate } = t.transform;
  return t.arcs.map((arc) => {
    let x = 0;
    let y = 0;
    return arc.map(([dx, dy]) => {
      x += dx;
      y += dy;
      return [x * scale[0] + translate[0], y * scale[1] + translate[1]] as [number, number];
    });
  });
}

const ringOf = (indexes: number[], arcs: Ring[]): Ring =>
  indexes.flatMap((i, n) => {
    const arc = i >= 0 ? arcs[i] : arcs[~i]?.slice().reverse();
    // Neighbouring arcs share an end point; keep it once.
    return (n === 0 ? arc : arc?.slice(1)) ?? [];
  });

function inside(lon: number, lat: number, rings: Ring[]): boolean {
  let hit = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i] ?? [0, 0];
      const [xj, yj] = ring[j] ?? [0, 0];
      if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) hit = !hit;
    }
  }
  return hit;
}

const StoredLandGrid = z.object({ stepDeg: z.number(), rows: z.array(z.string()) });

/** The world's land as a coarse lattice, for the dot-matrix world view. Computed once and kept on disk. */
export function landGrid(): Promise<LandGrid> {
  return diskMemo("reach-land-v1", 90 * 86_400_000, async () => {
    const topo = await fetchJson(SOURCE, URL_110M, topology, { timeoutMs: 20_000 });
    const arcs = decodeArcs(topo);
    const shapes = topo.objects.land.geometries.flatMap((g) => {
      const polygons = (g.type === "Polygon" ? [g.arcs as number[][]] : (g.arcs as number[][][])).map((rings) => rings.map((r) => ringOf(r, arcs)));
      return polygons.map((rings) => {
        const pts = rings.flat();
        return { rings, west: Math.min(...pts.map((p) => p[0])), east: Math.max(...pts.map((p) => p[0])), south: Math.min(...pts.map((p) => p[1])), north: Math.max(...pts.map((p) => p[1])) };
      });
    });
    const rows: string[] = [];
    for (let r = 0; r < 180 / STEP_DEG; r++) {
      const lat = 90 - (r + 0.5) * STEP_DEG;
      let row = "";
      for (let c = 0; c < 360 / STEP_DEG; c++) {
        const lon = -180 + (c + 0.5) * STEP_DEG;
        row += shapes.some((s) => lon >= s.west && lon <= s.east && lat >= s.south && lat <= s.north && inside(lon, lat, s.rings)) ? "1" : "0";
      }
      rows.push(row);
    }
    return { stepDeg: STEP_DEG, rows } satisfies LandGrid;
  }, StoredLandGrid);
}
