import { describe, expect, test } from "bun:test";
import type { ExpressionSpecification, LayerSpecification } from "maplibre-gl";
import { FADE_MS, MarkFades, diffMarks, fadedOpacity, withFade } from "./feature-fade";

const FADE: ExpressionSpecification = ["number", ["feature-state", "fade"], 1];

describe("fadedOpacity", () => {
  test("multiplies a number or a data expression by the fade", () => {
    expect(fadedOpacity(0.6)).toEqual(["*", 0.6, FADE]);
    expect(fadedOpacity(["case", ["get", "selected"], 1, 0.5])).toEqual(["*", ["case", ["get", "selected"], 1, 0.5], FADE]);
  });

  test("an unset opacity becomes the fade itself", () => {
    expect(fadedOpacity(undefined)).toEqual(FADE);
  });

  test("keeps a zoom curve outermost and fades each of its outputs", () => {
    expect(fadedOpacity(["interpolate", ["linear"], ["zoom"], 12, 0, 14, ["get", "o"]])).toEqual(["interpolate", ["linear"], ["zoom"], 12, ["*", 0, FADE], 14, ["*", ["get", "o"], FADE]]);
    expect(fadedOpacity(["step", ["zoom"], 0, 15, 0.8])).toEqual(["step", ["zoom"], ["*", 0, FADE], 15, ["*", 0.8, FADE]]);
  });

  test("a curve over data, not zoom, is faded as a whole", () => {
    const curve = ["interpolate", ["linear"], ["get", "alt"], 0, 0.4, 1000, 1];
    expect(fadedOpacity(curve)).toEqual(["*", curve, FADE]);
  });
});

describe("withFade", () => {
  test("fades every per-feature opacity of a layer and keeps its other paint", () => {
    const layer: LayerSpecification = { id: "x-dot", type: "circle", source: "x", paint: { "circle-color": "#fff", "circle-opacity": 0.5 } };
    expect(withFade(layer)).toEqual({ ...layer, paint: { "circle-color": "#fff", "circle-opacity": ["*", 0.5, FADE], "circle-stroke-opacity": FADE } });
  });

  test("leaves layers without per-feature opacity alone", () => {
    const solid: LayerSpecification = { id: "x-solid", type: "fill-extrusion", source: "x", paint: { "fill-extrusion-opacity": 0.9 } };
    expect(withFade(solid)).toBe(solid);
  });
});

describe("diffMarks", () => {
  test("names marks that enter, leave and come back while fading out", () => {
    const shown = new Set(["a", "b", "c"]);
    const leaving = new Set(["c"]);
    expect(diffMarks(shown, leaving, new Set(["a", "c", "d"]))).toEqual({ entering: ["d"], returning: ["c"], left: ["b"] });
  });

  test("a mark already fading out is not left again", () => {
    expect(diffMarks(new Set(["a", "b"]), new Set(["b"]), new Set(["a"]))).toEqual({ entering: [], returning: [], left: [] });
  });
});

describe("MarkFades", () => {
  function setup() {
    const states = new Map<string | number, number>();
    let listener: ((event: { sourceId: string; isSourceLoaded: boolean }) => void) | undefined;
    let drawn: GeoJSON.FeatureCollection | undefined;
    let active = false;
    const removed: (string | number)[] = [];
    // The controller uses only these source and state operations; no renderer is mocked.
    const map = {
      on: (_event: string, fn: (event: { sourceId: string; isSourceLoaded: boolean }) => void) => { listener = fn; },
      off: () => { listener = undefined; },
      getSource: () => ({}),
      setFeatureState: ({ id }: { id: string | number }, state: { fade: number }) => { states.set(id, state.fade); },
      removeFeatureState: ({ id }: { id: string | number }) => { removed.push(id); states.delete(id); },
    } as unknown as import("maplibre-gl").Map;
    const fades = new MarkFades(map, "marks", "id", (data) => { drawn = data; }, (value) => { active = value; });
    const arrived = () => listener?.({ sourceId: "marks", isSourceLoaded: true });
    return { fades, states, arrived, removed, drawn: () => drawn, active: () => active, listening: () => listener !== undefined };
  }
  const data = (...ids: string[]): GeoJSON.FeatureCollection => ({ type: "FeatureCollection", features: ids.map((id) => ({ type: "Feature", properties: { id }, geometry: { type: "Point", coordinates: [4, 51] } })) });

  test("retains departures until their fade ends and clears state after source arrival", () => {
    const h = setup();
    h.fades.next(data("a"));
    expect(h.states.get("a")).toBe(0);
    expect(h.active()).toBe(true);
    h.arrived();
    h.fades.step(performance.now() + FADE_MS);
    expect(h.states.get("a")).toBe(1);
    expect(h.active()).toBe(false);
    expect(h.fades.next(null).features).toHaveLength(1);
    h.fades.step(performance.now() + FADE_MS);
    expect(h.drawn()?.features).toHaveLength(0);
    expect(h.states.get("a")).toBe(0);
    expect(h.removed).toEqual([]);
    h.arrived();
    expect(h.removed).toEqual(["a"]);
    h.fades.dispose();
    expect(h.listening()).toBe(false);
  });

  test("a returning mark reverses its departure without a duplicate", () => {
    const h = setup();
    h.fades.next(data("a"));
    h.arrived();
    h.fades.step(performance.now() + FADE_MS);
    h.fades.next(null);
    expect(h.fades.next(data("a")).features).toHaveLength(1);
    h.fades.step(performance.now() + FADE_MS);
    expect(h.states.get("a")).toBe(1);
    expect(h.active()).toBe(false);
  });

  test("starts an arrival even when source events do not arrive", () => {
    const h = setup();
    h.fades.next(data("a"));
    const now = performance.now();
    h.fades.step(now + 401);
    expect(h.states.get("a")).toBe(0);
    h.fades.step(now + 401 + FADE_MS);
    expect(h.states.get("a")).toBe(1);
    expect(h.active()).toBe(false);
  });
});
