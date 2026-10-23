import type { Map as MapLibreMap } from "maplibre-gl";
import { addMapLayers } from "../city/extension";
import type { Tint } from "./store";
import type { Era } from "./types";

export interface Look {
  tint: Tint;
  /** 0–1: how strongly the past shows over what is beneath. */
  strength: number;
}

/**
 * Raster paint for each tint. "True colour" shows the scan as published. "Night tint" pulls the scan
 * toward the dark blue of the City map: less saturation, a lower white point and a hue turn that makes
 * the yellowed paper of old maps read as blue-grey, then a translucent blue wash over the sheet. Raster paint
 * cannot add colour to a black-and-white aerial photograph; the wash can.
 */
const PAINT_PROPS = ["raster-opacity", "raster-saturation", "raster-contrast", "raster-brightness-min", "raster-brightness-max", "raster-hue-rotate"] as const;
type PaintProp = (typeof PAINT_PROPS)[number];

const TINT: Record<Tint, Record<Exclude<PaintProp, "raster-opacity">, number>> = {
  true: { "raster-saturation": 0, "raster-contrast": 0, "raster-brightness-min": 0, "raster-brightness-max": 1, "raster-hue-rotate": 0 },
  night: { "raster-saturation": -0.35, "raster-contrast": 0.1, "raster-brightness-min": 0, "raster-brightness-max": 0.8, "raster-hue-rotate": 195 },
};

const WASH_COLOUR = "#0a2740";
const WASH_MAX = 0.42;
/** How much of its opacity the base map's lettering loses under a fully strong sheet. */
const LABEL_FADE = 0.75;

const washOpacity = (look: Look): number => (look.tint === "night" ? WASH_MAX * look.strength : 0);

function paint(look: Look): Record<PaintProp, number> {
  return { ...TINT[look.tint], "raster-opacity": look.strength };
}

/**
 * One historical raster on one map, with a cross-fade whenever the era changes: the new sheet fades in
 * while the old one fades out and is then removed. Works on the City map and on the swipe overlay map.
 */
export class EraSheet {
  private current: { era: Era; id: string; wash: string } | null = null;
  private serial = 0;
  private disposed = false;
  private timers = new Set<ReturnType<typeof setTimeout>>();

  /** `beneathLabels` lays the sheet over the base map's roads and water but under its labels, so street names stay readable. */
  constructor(
    private readonly map: MapLibreMap,
    private readonly beneathLabels: boolean,
    private readonly fadeMs: number,
  ) {}

  show(era: Era | null, look: Look): void {
    if (this.disposed) return;
    if (era?.id === this.current?.era.id) {
      this.restyle(look);
      return;
    }
    this.retire();
    if (!era) return;

    const id = `timemachine-era-${this.serial++}`;
    this.map.addSource(id, { type: "raster", tiles: [era.tiles], tileSize: 256, minzoom: era.minzoom, maxzoom: era.maxzoom });
    const wash = `${id}-wash`;
    const transition = { duration: this.fadeMs, delay: 0 };
    addMapLayers(this.map, [
      { id, type: "raster", source: id, paint: { ...paint(look), "raster-opacity": 0, "raster-opacity-transition": transition, "raster-fade-duration": this.fadeMs ? 240 : 0 } },
      { id: wash, type: "background", paint: { "background-color": WASH_COLOUR, "background-opacity": 0, "background-opacity-transition": transition } },
    ], this.beneathLabels);
    this.current = { era, id, wash };
    // One frame at opacity 0, so the browser has something to fade from.
    requestAnimationFrame(() => {
      if (this.current?.id !== id || !this.map.getLayer(id)) return;
      this.map.setPaintProperty(id, "raster-opacity", look.strength);
      this.map.setPaintProperty(wash, "background-opacity", washOpacity(look));
    });
  }

  /** Change tint or strength of the sheet that is showing. */
  restyle(look: Look): void {
    const sheet = this.current;
    if (this.disposed || !sheet || !this.map.getLayer(sheet.id)) return;
    // A slider drag should follow the finger; only an era change gets the long cross-fade.
    const quick = { duration: Math.min(this.fadeMs, 120), delay: 0 };
    this.map.setPaintProperty(sheet.id, "raster-opacity-transition", quick);
    this.map.setPaintProperty(sheet.wash, "background-opacity-transition", quick);
    const next = paint(look);
    for (const name of PAINT_PROPS) this.map.setPaintProperty(sheet.id, name, next[name]);
    this.map.setPaintProperty(sheet.wash, "background-opacity", washOpacity(look));
  }

  /** After this the sheet ignores every call, so a stale reference in a re-run effect cannot touch a removed map. */
  dispose(): void {
    this.disposed = true;
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    this.remove(this.current);
    this.current = null;
  }

  private retire(): void {
    const old = this.current;
    this.current = null;
    if (!old || !this.map.getLayer(old.id)) return;
    const transition = { duration: this.fadeMs, delay: 0 };
    this.map.setPaintProperty(old.id, "raster-opacity-transition", transition);
    this.map.setPaintProperty(old.id, "raster-opacity", 0);
    this.map.setPaintProperty(old.wash, "background-opacity-transition", transition);
    this.map.setPaintProperty(old.wash, "background-opacity", 0);
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      this.remove(old);
    }, this.fadeMs + 80);
    this.timers.add(timer);
  }

  private remove(sheet: { id: string; wash: string } | null): void {
    // The map may already be torn down when the City screen unmounts.
    if (!sheet || !this.map.style) return;
    for (const layer of [sheet.wash, sheet.id]) if (this.map.getLayer(layer)) this.map.removeLayer(layer);
    if (this.map.getSource(sheet.id)) this.map.removeSource(sheet.id);
  }
}

const remembered = new WeakMap<MapLibreMap, Map<string, number>>();

/** Set `property` of a layer to a share of the value it started with. 1 puts the original back. Skips values that are expressions. */
function scale(map: MapLibreMap, layerId: string, property: "fill-extrusion-opacity" | "text-opacity", share: number): void {
  const memory = remembered.get(map) ?? new Map<string, number>();
  remembered.set(map, memory);
  const key = `${layerId}:${property}`;
  if (!memory.has(key)) {
    const current = map.getPaintProperty(layerId, property);
    if (current !== undefined && typeof current !== "number") return;
    memory.set(key, current ?? 1);
  }
  map.setPaintProperty(layerId, property, (memory.get(key) ?? 1) * share);
}

/**
 * Quiet the map beneath a sheet. The 3D buildings fade out with it, so a Ferraris map is not pierced by today's
 * towers; the street and place names of the base map fall back, so they do not scribble over the old lettering.
 * Only layers drawn from the base map's vector tiles are touched, never another plugin's markers.
 * `strength` 0 puts everything back.
 */
export function dimBase(map: MapLibreMap, strength: number): void {
  if (!map.style) return;
  for (const layer of map.getStyle().layers) {
    if (layer.type === "fill-extrusion") scale(map, layer.id, "fill-extrusion-opacity", 1 - strength);
    else if (layer.type === "symbol" && "source-layer" in layer) scale(map, layer.id, "text-opacity", 1 - LABEL_FADE * strength);
  }
}
