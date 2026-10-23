import { useEffect, useMemo, useState } from "react";
import { api } from "../../app/core/api";
import { useScreenActive } from "../../app/core/hooks";
import type { LatLon } from "../../shared/geo";
import type { GridFeature, GridKind, GridTile } from "./types";

/** Street-grid tiles are zoom-14 slippy-map tiles; every grid layer shares this cache. */
export const TILE_ZOOM = 14;
const MAX_TILES = 16;

export function tileOf(p: LatLon): { x: number; y: number } {
  const n = 2 ** TILE_ZOOM;
  const lat = (p.lat * Math.PI) / 180;
  return { x: Math.floor(((p.lon + 180) / 360) * n), y: Math.floor(((1 - Math.log(Math.tan(lat) + 1 / Math.cos(lat)) / Math.PI) / 2) * n) };
}

export interface Bounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

/** Tiles covering the bounds, nearest to the centre first, capped so a zoomed-out view stays polite. */
export function tilesFor(b: Bounds): { x: number; y: number }[] {
  const nw = tileOf({ lat: b.north, lon: b.west });
  const se = tileOf({ lat: b.south, lon: b.east });
  const c = tileOf({ lat: (b.north + b.south) / 2, lon: (b.west + b.east) / 2 });
  const out: { x: number; y: number }[] = [];
  for (let x = nw.x; x <= se.x; x++) for (let y = nw.y; y <= se.y; y++) out.push({ x, y });
  return out.sort((a, b2) => Math.hypot(a.x - c.x, a.y - c.y) - Math.hypot(b2.x - c.x, b2.y - c.y)).slice(0, MAX_TILES);
}

const cache = new Map<string, Promise<GridTile>>();

/**
 * Uncached tiles can take Overpass 20 s or more. Browsers allow about six connections per host, so at most
 * two tile requests run at once; the rest wait here instead of blocking every other live layer.
 */
const MAX_IN_FLIGHT = 2;
let inFlight = 0;
const waiting: (() => void)[] = [];

async function throttled<T>(task: () => Promise<T>): Promise<T> {
  if (inFlight >= MAX_IN_FLIGHT) await new Promise<void>((resolve) => waiting.push(resolve));
  inFlight++;
  try {
    return await task();
  } finally {
    inFlight--;
    waiting.shift()?.();
  }
}

export function loadTile(x: number, y: number, signal?: AbortSignal): Promise<GridTile> {
  if (signal) {
    if (signal.aborted) return Promise.reject(signal.reason);
    // Nearby views use the server cache; cancelling one must not abort a map's shared tile request.
    return throttled(() => {
      signal.throwIfAborted();
      return api<GridTile>(`/api/grid/tile?x=${x}&y=${y}`, { signal });
    });
  }
  const key = `${x}/${y}`;
  let hit = cache.get(key);
  if (!hit) {
    hit = throttled(() => api<GridTile>(`/api/grid/tile?x=${x}&y=${y}`));
    hit.catch(() => cache.delete(key));
    cache.set(key, hit);
  }
  return hit;
}

export interface GridData {
  features: GridFeature[];
  loading: boolean;
  error: string | null;
}

/**
 * Features of the given kinds inside the bounds. Tiles stream in one by one, nearest first,
 * so the map fills from the centre outward.
 */
export function useGrid(bounds: Bounds, kinds: readonly GridKind[]): GridData {
  const active = useScreenActive();
  const tiles = useMemo(() => tilesFor(bounds), [bounds.west, bounds.south, bounds.east, bounds.north]);
  const tileKey = tiles.map((t) => `${t.x}/${t.y}`).join(",");
  const [loaded, setLoaded] = useState<Map<string, GridTile>>(new Map());
  const [pending, setPending] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!active) return;
    let alive = true;
    setPending(tiles.length);
    for (const t of tiles) {
      loadTile(t.x, t.y)
        .then((tile) => {
          if (!alive) return;
          setLoaded((prev) => (prev.has(`${t.x}/${t.y}`) ? prev : new Map(prev).set(`${t.x}/${t.y}`, tile)));
          setError(null);
        })
        .catch((err: unknown) => alive && setError(err instanceof Error ? err.message : String(err)))
        .finally(() => alive && setPending((n) => n - 1));
    }
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tileKey, active]);

  const kindKey = kinds.join(",");
  const features = useMemo(() => {
    const wanted = new Set(kinds);
    const visible = new Set(tileKey.split(","));
    const out: GridFeature[] = [];
    for (const [key, tile] of loaded) if (visible.has(key)) for (const f of tile.features) if (wanted.has(f.properties.kind)) out.push(f);
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, tileKey, kindKey]);

  return { features, loading: pending > 0, error };
}
