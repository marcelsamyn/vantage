/** Payloads served by /api/timemachine. Shared by api.ts (server) and the browser code. */

/** What the picture is: a drawn map, an aerial photograph, or a view from orbit. */
export type EraKind = "map" | "aerial" | "orbit";

/** One layer of the past that a map can show: a historical map or aerial photo with its source. */
export interface Era {
  /** Stable id, e.g. "flanders.ferraris". */
  id: string;
  /** Sort key. Ranges use their middle year. */
  year: number;
  /** The year as printed: "1777" or "1950–65". */
  yearLabel: string;
  /** Short name: "Ferraris", "aerial". */
  name: string;
  /** "1777 · Ferraris" */
  label: string;
  kind: EraKind;
  /** One line of context for the era. */
  context: string;
  /** Who publishes the tiles. */
  publisher: string;
  /** What the publisher says about reuse. */
  licence: string;
  /** Raster tile URL template in MapLibre form ({z}/{x}/{y} or {bbox-epsg-3857}). */
  tiles: string;
  minzoom: number;
  /** Past this zoom the tiles only get blurrier, so the map stretches the last real level. */
  maxzoom: number;
  /** The zoom at which the era reads best: a 1712 map of a whole country makes no sense at street level. */
  viewZoom: number;
}

export interface ErasPayload {
  /** Eras with pictures at the asked place, oldest first. */
  eras: Era[];
  /** Publishers that did not answer; their eras may be missing from the list. */
  unreachable: string[];
}
