import { useEffect, useMemo, useState } from "react";
import { useScreenActive } from "../../app/core/hooks";
import { useGeoJsonLayer, useMapView, type MapLayerProps } from "../city/extension";
import { fetchTreeTile } from "./client";
import { openSpot } from "./spot";
import { streetTreeLayers, treeCollection } from "./tree-draw";
import type { MapTree, TreeTile } from "./types";

const ZOOM = 16;
const MAX_TILES = 9;

interface Tile {
  x: number;
  y: number;
}

const tileKey = (t: Tile): string => `${t.x}/${t.y}`;

function tileAt(lat: number, lon: number): Tile {
  const n = 2 ** ZOOM;
  const rad = (lat * Math.PI) / 180;
  return { x: Math.floor(((lon + 180) / 360) * n), y: Math.floor(((1 - Math.asinh(Math.tan(rad)) / Math.PI) / 2) * n) };
}

/** Zoom-16 tiles covering the view, nearest the centre first, capped so a wide view stays polite. */
function visibleTiles(v: { west: number; east: number; south: number; north: number; center: { lat: number; lon: number } }): Tile[] {
  const nw = tileAt(v.north, v.west);
  const se = tileAt(v.south, v.east);
  const c = tileAt(v.center.lat, v.center.lon);
  const out: Tile[] = [];
  for (let x = nw.x; x <= se.x; x++) for (let y = nw.y; y <= se.y; y++) out.push({ x, y });
  return out.sort((a, b) => Math.hypot(a.x - c.x, a.y - c.y) - Math.hypot(b.x - c.x, b.y - c.y)).slice(0, MAX_TILES);
}

const cache = new Map<string, Promise<TreeTile>>();
function loadTile(t: Tile): Promise<TreeTile> {
  const key = tileKey(t);
  let hit = cache.get(key);
  if (!hit) {
    hit = fetchTreeTile(t.x, t.y);
    hit.catch(() => cache.delete(key));
    cache.set(key, hit);
  }
  return hit;
}

/** Street trees from the city registers, fetched one map tile at a time for the area on screen. */
export default function TreesLayer({ map, report }: MapLayerProps): null {
  const active = useScreenActive();
  const view = useMapView(map);
  const tiles = useMemo(() => visibleTiles(view), [view.west, view.east, view.south, view.north]);
  const key = tiles.map(tileKey).join(",");
  const [loaded, setLoaded] = useState<Map<string, TreeTile>>(new Map());
  const [pending, setPending] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!active) return;
    let alive = true;
    setPending(tiles.length);
    void (async () => {
      for (const t of tiles) {
        try {
          const tile = await loadTile(t);
          if (!alive) return;
          setLoaded((prev) => (prev.has(tileKey(t)) ? prev : new Map(prev).set(tileKey(t), tile)));
          setError(null);
        } catch (err) {
          if (alive) setError(err instanceof Error ? err.message : String(err));
        } finally {
          if (alive) setPending((n) => n - 1);
        }
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, active]);

  const shown = useMemo(() => {
    const visible = new Set(key.split(","));
    const trees: MapTree[] = [];
    let covered = false;
    let complete = true;
    for (const k of visible) {
      const tile = loaded.get(k);
      if (!tile) {
        complete = false;
        continue;
      }
      if (tile.sources.length > 0) covered = true;
      trees.push(...tile.trees);
    }
    return { trees, covered, complete };
  }, [loaded, key]);

  useEffect(() => {
    const uncovered = shown.complete && !shown.covered && shown.trees.length === 0;
    report({
      loading: pending > 0 && shown.trees.length === 0,
      error: error ?? (uncovered ? "No city register covers this area. Covered: Brussels, Ghent, Paris, Bologna." : null),
      count: shown.trees.length,
    });
  }, [report, pending, error, shown]);

  const points = useMemo(() => treeCollection(shown.trees), [shown.trees]);
  const byId = useMemo(() => new Map(shown.trees.map((t) => [t.id, t])), [shown.trees]);

  useGeoJsonLayer(map, {
    id: "dossier-trees",
    data: points,
    clickable: ["dossier-trees-dot"],
    onClick: (f) => {
      const hit = byId.get(String(f.properties.id));
      if (hit) openSpot({ id: hit.id, name: hit.name, kind: "tree", context: hit.remarkable ? "Remarkable tree" : "Street tree", lat: hit.lat, lon: hit.lon });
    },
    layers: streetTreeLayers,
  });
  return null;
}
