import type { LucideIcon } from "lucide-react";
import type { ExpressionSpecification, FilterSpecification, GeoJSONSource, LayerSpecification, Map as MapLibreMap, MapGeoJSONFeature, MapSourceDataEvent, Marker, PointLike, SymbolLayerSpecification } from "maplibre-gl";
import { createElement, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { useAnimationFrame, usePrefersReducedMotion } from "../../app/core/hooks";
import type { Glyph } from "../../app/ui";
import type { LatLon } from "../../shared/geo";
import { FADE_MS, MarkFades, fadedOpacity, withFade } from "./feature-fade";
import { addMapLayers } from "./layer-order";
import { featureDistance, nearestHit, type Candidate, type Pt, type ScreenShape } from "./hit";

/** Design tokens as literal colours — MapLibre paints with values, not CSS variables. */
export const MAP_INK = {
  void: "#05070a",
  bone: "#e6ecf0",
  fog: "#8b97a3",
  ash: "#56616d",
  ice: "#82e4ff",
  sodium: "#ffb547",
  alarm: "#ff4f5e",
  mint: "#6ff2b4",
} as const;

const fadingLayers = new WeakMap<MapLibreMap, Set<string>>();

export const emptyCollection = (): GeoJSON.FeatureCollection => ({ type: "FeatureCollection", features: [] });

// ── View ──────────────────────────────────────────────────────────

export interface MapView {
  west: number;
  south: number;
  east: number;
  north: number;
  zoom: number;
  center: LatLon;
}

function readView(map: MapLibreMap): MapView {
  const b = map.getBounds();
  const c = map.getCenter();
  return { west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth(), zoom: map.getZoom(), center: { lat: c.lat, lon: c.lng } };
}

/** How long the camera rests before `onCameraRest` reports. */
const REST_MS = 250;
/** The longest a camera that keeps moving by itself, such as one following you, holds a report back after a move. */
const SELF_MOVING_MS = 1000;

/** The two camera events `onCameraRest` reads; the map provides them. */
export interface MoveEvents {
  on(type: "movestart" | "moveend", listener: (e: { originalEvent?: unknown }) => void): unknown;
  off(type: "movestart" | "moveend", listener: (e: { originalEvent?: unknown }) => void): unknown;
}

/**
 * Call `fn` once the camera has rested for a moment after a move. Layers re-render and fetch on what it reports, and
 * a drag that cuts a fling short ends one move as the next begins: the wait keeps that burst out of the gesture. A
 * gesture of yours holds the report until you let go. A camera that moves by itself, following you, may never rest,
 * so it reports within a second of each move it ends. Returns the unsubscribe.
 */
export function onCameraRest(map: MoveEvents, fn: () => void): () => void {
  let rest: ReturnType<typeof setTimeout> | undefined;
  let ceiling: ReturnType<typeof setTimeout> | undefined;
  const report = (): void => {
    clearTimeout(rest);
    clearTimeout(ceiling);
    ceiling = undefined;
    fn();
  };
  const ended = (): void => {
    clearTimeout(rest);
    rest = setTimeout(report, REST_MS);
    ceiling ??= setTimeout(report, SELF_MOVING_MS);
  };
  const started = (e: { originalEvent?: unknown }): void => {
    clearTimeout(rest);
    if (!e.originalEvent) return;
    clearTimeout(ceiling);
    ceiling = undefined;
  };
  map.on("moveend", ended);
  map.on("movestart", started);
  return () => {
    clearTimeout(rest);
    clearTimeout(ceiling);
    map.off("moveend", ended);
    map.off("movestart", started);
  };
}

/** The visible area, updated once the camera rests. Use it to fetch only what is on screen. */
export function useMapView(map: MapLibreMap): MapView {
  const [view, setView] = useState(() => readView(map));
  useEffect(() => onCameraRest(map, () => setView(readView(map))), [map]);
  return view;
}

// ── Taps ──────────────────────────────────────────────────────────

/** What a tap on one clickable layer does with the feature it reached. */
const featureTaps = new WeakMap<MapLibreMap, Map<string, (feature: MapGeoJSONFeature) => void>>();

/** Something outside the map's style that takes taps, such as a DOM marker: how far it is from the tap, and what it does. */
export interface TapTarget {
  distance: number;
  activate: () => void;
}
type TapFinder = (point: Pt, radius: number) => TapTarget[];
const tapFinders = new WeakMap<MapLibreMap, Set<TapFinder>>();

/** Offer things that are not map features, such as markers drawn in the DOM, to taps that land near them. */
export function useTapTargets(map: MapLibreMap, find: TapFinder): void {
  const ref = useRef(find);
  ref.current = find;
  useEffect(() => {
    const finder: TapFinder = (point, radius) => ref.current(point, radius);
    const set = tapFinders.get(map) ?? new Set<TapFinder>();
    tapFinders.set(map, set);
    set.add(finder);
    return () => {
      set.delete(finder);
    };
  }, [map]);
}

function screenShape(map: MapLibreMap, geometry: GeoJSON.Geometry): ScreenShape {
  const px = (c: GeoJSON.Position): Pt => map.project([c[0] ?? 0, c[1] ?? 0]);
  switch (geometry.type) {
    case "Point":
      return { type: "points", points: [px(geometry.coordinates)] };
    case "MultiPoint":
      return { type: "points", points: geometry.coordinates.map(px) };
    case "LineString":
      return { type: "lines", lines: [geometry.coordinates.map(px)] };
    case "MultiLineString":
      return { type: "lines", lines: geometry.coordinates.map((l) => l.map(px)) };
    case "Polygon":
      return { type: "areas", rings: geometry.coordinates.slice(0, 1).map((r) => r.map(px)) };
    case "MultiPolygon":
      return { type: "areas", rings: geometry.coordinates.flatMap((poly) => poly.slice(0, 1).map((r) => r.map(px))) };
    case "GeometryCollection":
      return { type: "points", points: [] };
  }
}

/**
 * Hand a tap or click at `point` to the nearest clickable thing it reached: a feature of a clickable layer or a
 * registered tap target. A mouse click (`radius` 0) reaches what lies under the pointer; a touch reaches what lies
 * within `radius` pixels, so a fingertip need not land on a small marker. Returns false when it reached nothing.
 */
export function routeTap(map: MapLibreMap, point: Pt, radius: number): boolean {
  const taps = featureTaps.get(map);
  const layers = [...(taps?.keys() ?? [])].filter((id) => map.getLayer(id));
  const area: [PointLike, PointLike] | PointLike =
    radius > 0
      ? [
          [point.x - radius, point.y - radius],
          [point.x + radius, point.y + radius],
        ]
      : [point.x, point.y];
  const features = layers.length ? map.queryRenderedFeatures(area, { layers }) : [];
  // An extrusion's geometry is its footprint on the ground, which a raised solid does not cover on screen; the map
  // already tested the solid itself, so finding it means the tap reached it.
  const candidates: Candidate<() => void>[] = features.map((f) => ({ item: () => taps?.get(f.layer.id)?.(f), distance: featureDistance(point, screenShape(map, f.geometry), radius === 0 || f.layer.type === "fill-extrusion") }));
  for (const find of tapFinders.get(map) ?? []) candidates.push(...find(point, radius).map((t) => ({ item: t.activate, distance: t.distance })));
  const hit = nearestHit(candidates);
  hit?.();
  return hit !== null;
}

// ── GeoJSON layer ─────────────────────────────────────────────────

export interface GeoJsonLayerOptions {
  /** Source id; must be unique on the map. Prefix with your plugin id. */
  id: string;
  data: GeoJSON.FeatureCollection | null;
  /** Style layers that draw this source. Give each an id prefixed with the source id. */
  layers: (source: string) => LayerSpecification[];
  /** Layer ids (from `layers`) that respond to clicks and taps and show a pointer cursor. */
  clickable?: string[];
  /** A click, or on a touch screen a tap near enough, on a feature of a `clickable` layer. */
  onClick?: (feature: MapGeoJSONFeature) => void;
  /** Draw beneath street labels (good for areas and lines). Default: on top of everything. */
  belowLabels?: boolean;
  /** Feature property to use as the feature id, enabling feature-state styling. */
  promoteId?: string;
  /**
   * Feature property that names each mark, unique within the source: marks then fade in as they appear and out as
   * they leave. It also serves as the feature id, in place of `promoteId`.
   */
  fadeBy?: string;
}

/**
 * GeoJSON sources are cut into tiles down to this zoom; deeper views scale those tiles up. Every `setData` cuts,
 * transfers and uploads each tile of its source again, and every frame draws each tile of every source, empty or
 * not. At MapLibre's default of 18 a pitched city view holds 20 tiles per source; at 13 it holds about 4, which
 * is most of what keeps the map smooth while layers update. Tiles at this zoom keep every vertex, snapped to
 * 1/8192 of the tile: half a pixel off at zoom 17, one at 18.
 */
const GEOJSON_MAXZOOM = 13;
/**
 * While the camera moves, a layer's new data reaches the map at most this often: tiling, transferring and uploading
 * it competes with the frame being drawn, so a layer that glides its marks steps four times a second then. The
 * newest data always lands, and at rest it lands at once.
 */
const MOVING_DATA_MS = 250;

/**
 * Add a GeoJSON source and its style layers for as long as the component is mounted.
 * Updating `data` swaps the features in place; unmounting removes everything it added.
 */
export function useGeoJsonLayer(map: MapLibreMap, options: GeoJsonLayerOptions): void {
  const { id, data, belowLabels, fadeBy } = options;
  const promoteId = fadeBy ?? options.promoteId;
  const reducedMotion = usePrefersReducedMotion();
  const fading = fadeBy !== undefined && !reducedMotion;
  const fadesRef = useRef<MarkFades | null>(null);
  const [animating, setAnimating] = useState(false);
  useAnimationFrame((_dt, _clock, now) => fadesRef.current?.step(now), fading && animating, "data", 30);
  const onClickRef = useRef(options.onClick);
  onClickRef.current = options.onClick;
  const specRef = useRef(options);
  specRef.current = options;
  // Every setData re-tiles the source in a worker and redraws the map, so an empty layer that stays empty skips it.
  const shownEmpty = useRef(true);
  const drawData = useRef((_data: GeoJSON.FeatureCollection | null): void => undefined);

  useEffect(() => {
    const { layers, clickable: clickIds = [] } = specRef.current;
    map.addSource(id, { type: "geojson", data: emptyCollection(), maxzoom: GEOJSON_MAXZOOM, ...(promoteId ? { promoteId } : {}) });
    shownEmpty.current = true;
    const fadeIds = fadingLayers.get(map) ?? new Set<string>();
    fadingLayers.set(map, fadeIds);
    const specs = layers(id).map((spec) => {
      const painted = fading ? withFade(spec) : spec;
      if (painted !== spec) fadeIds.add(spec.id);
      return painted;
    });
    addMapLayers(map, specs, belowLabels);
    // A source that draws nothing keeps its layers hidden, so MapLibre neither loads nor draws tiles for it.
    let drawing = false;
    const show = (on: boolean): void => {
      drawing = on;
      for (const spec of specs) if (map.getLayer(spec.id)) map.setLayoutProperty(spec.id, "visibility", on ? "visible" : "none");
    };
    show(false);
    const draw = (collection: GeoJSON.FeatureCollection): void => {
      const on = collection.features.length > 0;
      if (on !== drawing) show(on);
      (map.getSource(id) as GeoJSONSource | undefined)?.setData(collection);
    };
    const fades = fading && promoteId ? new MarkFades(map, id, promoteId, draw, setAnimating) : null;
    fadesRef.current = fades;
    drawData.current = (next) => draw(fades ? fades.next(next) : (next ?? emptyCollection()));

    const taps = featureTaps.get(map) ?? new Map<string, (feature: MapGeoJSONFeature) => void>();
    featureTaps.set(map, taps);
    const onTap = (f: MapGeoJSONFeature): void => onClickRef.current?.(f);
    const enter = (): void => {
      map.getCanvas().style.cursor = "pointer";
    };
    const leave = (): void => {
      map.getCanvas().style.cursor = "";
    };
    // City hands every tap to `routeTap`, which picks the nearest feature across all clickable layers.
    for (const layerId of clickIds) {
      taps.set(layerId, onTap);
      map.on("mouseenter", layerId, enter);
      map.on("mouseleave", layerId, leave);
    }

    return () => {
      fades?.dispose();
      fadesRef.current = null;
      for (const spec of specs) fadeIds.delete(spec.id);
      for (const layerId of clickIds) {
        taps.delete(layerId);
        map.off("mouseenter", layerId, enter);
        map.off("mouseleave", layerId, leave);
      }
      // The map may already be torn down when the City screen unmounts.
      if (!map.style) return;
      for (const spec of specs) if (map.getLayer(spec.id)) map.removeLayer(spec.id);
      if (map.getSource(id)) map.removeSource(id);
      map.getCanvas().style.cursor = "";
    };
  }, [map, id, belowLabels, promoteId, fading]);

  const sentAt = useRef(-Infinity);
  useEffect(() => {
    const empty = !data || data.features.length === 0;
    if (empty && shownEmpty.current) return;
    const send = (): void => {
      shownEmpty.current = empty;
      sentAt.current = performance.now();
      drawData.current(data);
    };
    const wait = map.isMoving() ? sentAt.current + MOVING_DATA_MS - performance.now() : 0;
    if (wait <= 0) {
      send();
      return;
    }
    const timer = setTimeout(send, wait);
    return () => clearTimeout(timer);
    // A rebuilt source starts empty, so the data goes out again.
  }, [map, id, data, belowLabels, promoteId, fading]);
}

// ── Pulses ────────────────────────────────────────────────────────

/** Paint writes per second of a map pulse. Every write redraws the whole map, so pulses settle for what the eye needs. */
const PULSE_FPS = 30;

type PaintName = Parameters<MapLibreMap["setPaintProperty"]>[1];
type PaintValue = Parameters<MapLibreMap["setPaintProperty"]>[2];

/**
 * Animate paint properties of one map layer in a loop: `paint(phase)` gets a phase from 0 to 1 that repeats every
 * `periodMs` and returns `[property, value]` pairs. It is an ambient loop at about 30 Hz: it runs only while
 * `active`, while the layer draws something inside the view, and while the motion policy allows, so the map stops
 * redrawing when nothing visible pulses or nobody watches. Pass `active` false when the layer has nothing to pulse.
 */
export function useMapPulse(map: MapLibreMap, layerId: string, periodMs: number, paint: (phase: number) => [PaintName, PaintValue][], active: boolean): void {
  const inView = useLayerInView(map, layerId, active);
  useAnimationFrame(
    (dt, t) => {
      // A still frame (dt 0) adds nothing: at rest the pulse holds its last phase, and under reduced motion the
      // layer keeps its own paint. Skipping it also spares the map a redraw.
      if (dt === 0 || !map.getLayer(layerId)) return;
      for (const [name, value] of paint((t % periodMs) / periodMs)) {
        // A pulse changes its own opacity without replacing the per-feature arrival/departure fade.
        const opacity = fadingLayers.get(map)?.has(layerId) && name.endsWith("-opacity");
        map.setPaintProperty(layerId, name, opacity ? fadedOpacity(value) as PaintValue : value);
      }
    },
    active && inView,
    "ambient",
    PULSE_FPS,
  );
}

/** Whether a layer draws any feature inside the view, checked when the view or the layer's data settles. */
function useLayerInView(map: MapLibreMap, layerId: string, watch: boolean): boolean {
  const [inView, setInView] = useState(false);
  useEffect(() => {
    if (!watch) return;
    const check = (): void => setInView(map.getLayer(layerId) !== undefined && map.queryRenderedFeatures({ layers: [layerId] }).length > 0);
    // Looked up per event: the layer may be added after this effect runs, and then it has no source yet.
    const onData = (e: MapSourceDataEvent): void => {
      if (e.isSourceLoaded && e.sourceId === map.getLayer(layerId)?.source) check();
    };
    check();
    map.on("moveend", check);
    map.on("sourcedata", onData);
    return () => {
      map.off("moveend", check);
      map.off("sourcedata", onData);
    };
  }, [map, layerId, watch]);
  return watch && inView;
}

// ── Icons ─────────────────────────────────────────────────────────

/** A lucide icon as white strokes on a 24 px grid. React draws it into a detached element; the ref sees it once committed. */
function lucideSvg(icon: LucideIcon): Promise<string> {
  return new Promise((resolve) => {
    const root = createRoot(document.createElement("div"));
    const done = (svg: SVGSVGElement | null): void => {
      if (!svg) return;
      resolve(svg.outerHTML);
      // React is still committing when the ref runs.
      setTimeout(() => root.unmount());
    };
    // Thicker than the UI's strokes: the map draws icons at 7–14 px over busy tiles.
    root.render(createElement(icon, { size: 24, color: "#fff", strokeWidth: 2.4, ref: done }));
  });
}

/** What an icon can be drawn from: SVG markup, a glyph (data on a 24 px grid), or a lucide-react icon. */
export type IconSource = string | Glyph | LucideIcon;

/** A glyph as standalone SVG markup in white, the shape `addMapIcon` draws into a canvas and the map tints. */
function glyphSvg(glyph: Glyph, strokeWidth = 2.2): string {
  const marks = glyph.map((m) => {
    const solid = m.fill ? ' fill="#fff" stroke="none"' : "";
    return "d" in m ? `<path d="${m.d}"${solid}/>` : `<circle cx="${m.circle[0]}" cy="${m.circle[1]}" r="${m.circle[2]}"${solid}/>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="${strokeWidth}" stroke-linecap="square" stroke-linejoin="miter">${marks.join("")}</svg>`;
}

const isGlyph = (icon: IconSource): icon is Glyph => Array.isArray(icon);

const iconMarkup = (icon: IconSource): Promise<string> => (typeof icon === "string" ? Promise.resolve(icon) : isGlyph(icon) ? Promise.resolve(glyphSvg(icon)) : lucideSvg(icon));

export interface MapIconOptions {
  size?: number;
  /** Register as a signed-distance field: a white silhouette that symbol layers tint with `icon-color`. */
  sdf?: boolean;
}

/** Register one icon under `name`, unless the map already has it. Rejects when the markup does not draw. */
export async function addMapIcon(map: MapLibreMap, name: string, icon: IconSource, { size = 48, sdf = true }: MapIconOptions = {}): Promise<void> {
  if (map.hasImage(name)) return;
  const markup = await iconMarkup(icon);
  const img = new Image(size, size);
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error(`Map icon "${name}" did not draw`));
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
  });
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.drawImage(img, 0, 0, size, size);
  // Another layer may have registered the same icon while this one was drawing.
  if (!map.hasImage(name)) map.addImage(name, ctx.getImageData(0, 0, size, size), { sdf, pixelRatio: 2 });
}

/**
 * Register an SVG, a glyph or a lucide icon as a map icon. With `sdf` (default) the icon is drawn as a white
 * silhouette that symbol layers tint with `icon-color`. Returns true once the icon can be used.
 */
export function useMapIcon(map: MapLibreMap, name: string, svg: IconSource, { size = 48, sdf = true }: MapIconOptions = {}): boolean {
  const [ready, setReady] = useState(() => map.hasImage(name));
  useEffect(() => {
    let alive = true;
    void addMapIcon(map, name, svg, { size, sdf }).then(() => {
      if (alive) setReady(true);
    });
    return () => {
      alive = false;
    };
  }, [map, name, svg, size, sdf]);
  return ready;
}

/** One icon to register: its map name and the module that holds it. */
export interface MapIconEntry {
  name: string;
  load: () => Promise<IconSource>;
  /** Canvas size in pixels; see `MapIconOptions`. */
  size?: number;
}

/**
 * Register a set of icons whose members change with what is on screen, such as one per switched-on layer. Returns
 * true once the whole set has been tried: an icon that fails to draw leaves its marks without a glyph rather than
 * holding back every other layer.
 */
export function useMapIcons(map: MapLibreMap, entries: readonly MapIconEntry[]): boolean {
  const key = entries.map((e) => e.name).join(",");
  const [done, setDone] = useState("");
  const ref = useRef(entries);
  ref.current = entries;
  useEffect(() => {
    let alive = true;
    void Promise.allSettled(ref.current.map(async (e) => addMapIcon(map, e.name, await e.load(), { size: e.size }))).then(() => {
      if (alive) setDone(key);
    });
    return () => {
      alive = false;
    };
  }, [map, key]);
  return done === key;
}

export interface RingIconOptions {
  /** A name registered with `useMapIcon` at the default size, or an expression that picks one. */
  icon: string | ExpressionSpecification;
  /** Usually the ring's stroke colour, so icon and ring read as one mark. */
  color: string | ExpressionSpecification;
  /** The icon's width in pixels: one value, or [zoom, px] stops. About 1.3 × the ring's radius leaves the stroke clear. */
  px: number | readonly (readonly [zoom: number, px: number])[];
  minzoom?: number;
  filter?: FilterSpecification;
}

/** A symbol layer, `<source>-icon`, that draws an icon inside a ring layer's disc. Add it after the ring. */
export function ringIcon(source: string, { icon, color, px, minzoom, filter }: RingIconOptions): SymbolLayerSpecification {
  // useMapIcon registers icons 48 px wide at pixel ratio 2, so size 1 is 24 px on screen.
  const size: number | ExpressionSpecification = typeof px === "number" ? px / 24 : ["interpolate", ["linear"], ["zoom"], ...px.flatMap(([z, p]) => [z, p / 24])];
  return {
    id: `${source}-icon`,
    type: "symbol",
    source,
    ...(minzoom === undefined ? {} : { minzoom }),
    ...(filter === undefined ? {} : { filter }),
    layout: { "icon-image": icon, "icon-size": size, "icon-allow-overlap": true, "icon-ignore-placement": true },
    paint: { "icon-color": color },
  };
}

// ── DOM markers ───────────────────────────────────────────────────

/** One mark drawn in the DOM: its element, and how to bring it in line with the newest copy of its item. */
export interface DomMarker<T> {
  element: HTMLElement;
  /** Runs right after the marker is built, and again each time the list changes. */
  update: (item: T) => void;
}

export interface DomMarkerOptions<T> {
  /** Stable across refreshes: each id is built once, and its marker leaves the map when the id leaves the list. */
  id: (item: T) => string;
  at: (item: T) => LatLon;
  build: (item: T) => DomMarker<T>;
  /** A click on the marker. It stops there, because the map takes a click that reaches it for one on empty ground. */
  onClick: (item: T) => void;
}

/** Manifests import this kit for `MAP_INK`, so it loads at startup; MapLibre loads with the map, so the class is fetched on first use. */
let markerClass: typeof Marker | null = null;

function useMarkerClass(): typeof Marker | null {
  // A class is a function, so both the initial state and the update are wrapped: React would call a bare one.
  const [loaded, setLoaded] = useState(() => markerClass);
  useEffect(() => {
    if (loaded) return;
    let alive = true;
    void import("maplibre-gl").then(
      (m) => {
        markerClass = m.Marker;
        if (alive) setLoaded(() => m.Marker);
      },
      // Thrown while React applies the update, so the layer's error boundary shows it.
      (err: unknown) => {
        if (alive)
          setLoaded(() => {
            throw err;
          });
      },
    );
    return () => {
      alive = false;
    };
  }, [loaded]);
  return loaded;
}

/**
 * Items as DOM markers, for marks the map canvas cannot draw well: a photo that loads straight from its source, a
 * pulse in CSS. MapLibre places each element with `transform`, so put hover and entrance motion on a child.
 */
export function useDomMarkers<T>(map: MapLibreMap, items: readonly T[], options: DomMarkerOptions<T>): void {
  const MarkerClass = useMarkerClass();
  const latestOptions = useRef(options);
  latestOptions.current = options;
  const placed = useRef(new Map<string, { marker: Marker; update: (item: T) => void }>());
  const latest = useRef(new Map<string, T>());

  useEffect(() => {
    if (!MarkerClass) return;
    const { id, at, build } = latestOptions.current;
    latest.current = new Map(items.map((item) => [id(item), item]));
    for (const [key, p] of placed.current) {
      if (latest.current.has(key)) continue;
      fadeOut(map, p.marker);
      placed.current.delete(key);
    }
    for (const [key, item] of latest.current) {
      const { lat, lon } = at(item);
      let p = placed.current.get(key);
      if (p) p.marker.setLngLat([lon, lat]);
      else {
        const { element, update } = build(item);
        element.addEventListener("click", (e) => {
          e.stopPropagation();
          const current = latest.current.get(key);
          if (current !== undefined) latestOptions.current.onClick(current);
        });
        element.classList.add("city-marker-in");
        element.addEventListener("animationend", () => element.classList.remove("city-marker-in"), { once: true });
        // Unrounded, like the map itself: a rounded marker snaps by up to half a pixel each time the camera stops.
        p = { marker: new MarkerClass({ element, anchor: "center", subpixelPositioning: true }).setLngLat([lon, lat]).addTo(map), update };
        placed.current.set(key, p);
      }
      p.update(item);
    }
  }, [map, items, MarkerClass]);

  useEffect(
    () => () => {
      for (const p of placed.current.values()) fadeOut(map, p.marker);
      placed.current.clear();
    },
    [map],
  );
}

/** Take a DOM marker off the map once it has faded out; at once under reduced motion, or when the map itself is gone. */
function fadeOut(map: MapLibreMap, marker: Marker): void {
  if (!map.style || matchMedia("(prefers-reduced-motion: reduce)").matches) {
    marker.remove();
    return;
  }
  const element = marker.getElement();
  element.classList.remove("city-marker-in");
  element.classList.add("city-marker-out");
  // Faded out, it no longer takes clicks meant for the map beneath.
  element.style.pointerEvents = "none";
  setTimeout(() => marker.remove(), FADE_MS);
}
