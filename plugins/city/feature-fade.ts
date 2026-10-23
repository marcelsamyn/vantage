import type { ExpressionSpecification, LayerSpecification, Map as MapLibreMap, MapSourceDataEvent } from "maplibre-gl";

/** How long a mark takes to fade in or out. */
export const FADE_MS = 320;
/** A fade-in starts when its tiles arrive; if they take longer than this, it starts anyway. */
const ARRIVAL_WAIT_MS = 400;

/** A mark's fade, from 0 (hidden) to 1 (shown). */
const FADE: ExpressionSpecification = ["number", ["feature-state", "fade"], 1];

/** The paint properties that set a layer's opacity per feature. Extrusions take one opacity for the whole layer, so they cannot fade per mark. */
const OPACITY: Partial<Record<LayerSpecification["type"], readonly string[]>> = {
  circle: ["circle-opacity", "circle-stroke-opacity"],
  symbol: ["icon-opacity", "text-opacity"],
  line: ["line-opacity"],
  fill: ["fill-opacity"],
};

const isZoom = (value: unknown): boolean => Array.isArray(value) && value[0] === "zoom";

/** An opacity value multiplied by the mark's fade. A zoom curve must stay outermost, so the fade goes into each of its outputs. */
export function fadedOpacity(value: unknown): unknown {
  if (value === undefined) return FADE;
  if (typeof value === "number") return ["*", value, FADE];
  if (!Array.isArray(value)) return value;
  const [op, ...args] = value as unknown[];
  if (op === "interpolate" && isZoom(args[1])) return [op, args[0], args[1], ...args.slice(2).map((v, i) => (i % 2 === 1 ? fadedOpacity(v) : v))];
  if (op === "step" && isZoom(args[0])) return [op, args[0], fadedOpacity(args[1]), ...args.slice(2).map((v, i) => (i % 2 === 1 ? fadedOpacity(v) : v))];
  return ["*", value, FADE];
}

/** The layer with each per-feature opacity multiplied by the mark's fade. */
export function withFade(spec: LayerSpecification): LayerSpecification {
  const names = OPACITY[spec.type];
  if (!names) return spec;
  const paint: Record<string, unknown> = { ...("paint" in spec ? spec.paint : {}) };
  for (const name of names) paint[name] = fadedOpacity(paint[name]);
  // The paint object keeps the layer's own properties and replaces opacities with expressions of the same type, which
  // the spec types cannot follow through a computed key.
  return { ...spec, paint } as LayerSpecification;
}

export type FeatureKey = string | number;

/** Which marks enter, leave or come back between what the map shows and the next data. */
export function diffMarks(shown: ReadonlySet<FeatureKey>, leaving: ReadonlySet<FeatureKey>, next: ReadonlySet<FeatureKey>): { entering: FeatureKey[]; returning: FeatureKey[]; left: FeatureKey[] } {
  const entering: FeatureKey[] = [];
  const returning: FeatureKey[] = [];
  const left: FeatureKey[] = [];
  for (const key of next) {
    if (leaving.has(key)) returning.push(key);
    else if (!shown.has(key)) entering.push(key);
  }
  for (const key of shown) if (!next.has(key) && !leaving.has(key)) left.push(key);
  return { entering, returning, left };
}

interface Fade {
  from: number;
  to: number;
  /** When the fade began; null until the mark's tiles arrive. */
  start: number | null;
  queued: number;
}

const ease = (t: number): number => 1 - (1 - t) ** 3;

/**
 * Fades the marks of one GeoJSON source in as they appear and out as they leave. Each mark is named by a property
 * (the source's `promoteId`); its fade is feature state that the layer's opacity reads (see `withFade`). A mark that
 * leaves the data stays on the map until it has faded out.
 */
export class MarkFades {
  /** Marks on the map by key, those fading out included. */
  private readonly shown = new Map<FeatureKey, GeoJSON.Feature>();
  private readonly leaving = new Set<FeatureKey>();
  private readonly retired = new Set<FeatureKey>();
  private readonly fades = new Map<FeatureKey, Fade>();
  /** The layer's latest features, unnamed ones included. */
  private latest: GeoJSON.Feature[] = [];

  constructor(
    private readonly map: MapLibreMap,
    private readonly source: string,
    private readonly key: string,
    private readonly draw: (collection: GeoJSON.FeatureCollection) => void,
    private readonly animate: (active: boolean) => void,
  ) {
    map.on("sourcedata", this.arrived);
  }

  /** What to draw for new data: the data itself, plus the marks still fading out. */
  next(data: GeoJSON.FeatureCollection | null): GeoJSON.FeatureCollection {
    const now = performance.now();
    this.latest = data?.features ?? [];
    const byKey = new Map<FeatureKey, GeoJSON.Feature>();
    for (const feature of this.latest) {
      const key: unknown = feature.properties?.[this.key];
      if (typeof key === "string" || typeof key === "number") byKey.set(key, feature);
    }
    const { entering, returning, left } = diffMarks(new Set(this.shown.keys()), this.leaving, new Set(byKey.keys()));
    for (const key of entering) {
      this.fades.set(key, { from: 0, to: 1, start: null, queued: now });
      this.setFade(key, 0);
    }
    for (const key of returning) {
      this.leaving.delete(key);
      this.fades.set(key, { from: this.level(key, now), to: 1, start: now, queued: now });
    }
    for (const key of left) {
      this.leaving.add(key);
      this.fades.set(key, { from: this.level(key, now), to: 0, start: now, queued: now });
    }
    for (const [key, feature] of byKey) this.shown.set(key, feature);
    this.animate(this.fades.size > 0);
    return this.collection();
  }

  dispose(): void {
    this.map.off("sourcedata", this.arrived);
  }

  private collection(): GeoJSON.FeatureCollection {
    const ghosts: GeoJSON.Feature[] = [];
    for (const key of this.leaving) {
      const feature = this.shown.get(key);
      if (feature) ghosts.push(feature);
    }
    return { type: "FeatureCollection", features: ghosts.length ? [...this.latest, ...ghosts] : this.latest };
  }

  /** Fade-ins start once the source has drawn the data that holds them. */
  private readonly arrived = (e: MapSourceDataEvent): void => {
    if (e.sourceId !== this.source || !e.isSourceLoaded) return;
    const now = performance.now();
    for (const key of this.retired) {
      if (!this.shown.has(key)) this.map.removeFeatureState({ source: this.source, id: key }, "fade");
    }
    this.retired.clear();
    for (const fade of this.fades.values()) fade.start ??= now;
  };

  private level(key: FeatureKey, now: number): number {
    const fade = this.fades.get(key);
    if (!fade) return 1;
    if (fade.start === null) return fade.from;
    return fade.from + (fade.to - fade.from) * ease(Math.min(1, (now - fade.start) / FADE_MS));
  }

  private setFade(key: FeatureKey, value: number): void {
    this.map.setFeatureState({ source: this.source, id: key }, { fade: value });
  }

  /** Advance pending fades from the shared, visibility-aware data animation loop. */
  step(now: number): void {
    if (!this.map.getSource(this.source)) return;
    let gone = false;
    for (const [key, fade] of this.fades) {
      if (fade.start === null && now - fade.queued > ARRIVAL_WAIT_MS) fade.start = now;
      this.setFade(key, this.level(key, now));
      if (fade.start === null || now - fade.start < FADE_MS) continue;
      this.fades.delete(key);
      if (fade.to === 0) {
        this.leaving.delete(key);
        this.shown.delete(key);
        // Keep opacity at zero until the worker has removed the old feature.
        this.retired.add(key);
        gone = true;
      }
    }
    if (gone) this.draw(this.collection());
    this.animate(this.fades.size > 0);
  }
}
