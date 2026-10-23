import { isHelicopter } from "./operator";
import type { ExpressionSpecification } from "maplibre-gl";
import type { MapIconEntry } from "../city/extension";
import type { Aircraft } from "./types";

/**
 * Top-down silhouettes per kind of aircraft. The map draws one as a flat icon, and in 3D as a solid at the
 * aircraft's altitude. Shapes are rings on a 48 px grid, nose up, centred on (24, 24).
 */

export type Craft = "light" | "airliner" | "heavy" | "fast" | "helicopter" | "glider" | "balloon" | "drone" | "vehicle";

type Ring = readonly (readonly [number, number])[];

interface CraftShape {
  rings: readonly Ring[];
  /** Metres across the 48 px grid at the craft's typical true size: the smallest it is drawn in 3D. */
  sizeM: number;
  /** On-screen size relative to an airliner, so a heavy reads larger than a Cessna at any zoom. */
  scale: number;
}

/** A symmetric outline from its right half, nose first: the points are mirrored across the centre line. */
function mirrored(right: Ring): Ring {
  const left = [...right].reverse().map(([x, y]) => [48 - x, y] as const);
  return [...right, ...left.filter(([x]) => x !== 24)];
}

function circle(cx: number, cy: number, r: number, steps = 20): Ring {
  return Array.from({ length: steps }, (_, i) => [cx + r * Math.sin((2 * Math.PI * i) / steps), cy - r * Math.cos((2 * Math.PI * i) / steps)] as const);
}

/** A bar of `width` from (x1, y1) to (x2, y2). */
function bar(x1: number, y1: number, x2: number, y2: number, width: number): Ring {
  const len = Math.hypot(x2 - x1, y2 - y1);
  const nx = (-(y2 - y1) / len) * (width / 2);
  const ny = ((x2 - x1) / len) * (width / 2);
  return [
    [x1 + nx, y1 + ny],
    [x2 + nx, y2 + ny],
    [x2 - nx, y2 - ny],
    [x1 - nx, y1 - ny],
  ];
}

const clockwise = (ring: Ring): Ring => (screenArea(ring) < 0 ? [...ring].reverse() : ring);

export const SHAPES: Record<Craft, CraftShape> = {
  light: {
    rings: [mirrored([[24, 7], [25.4, 8], [25.6, 15], [44, 15.4], [44, 19.6], [25.4, 20.2], [24.9, 34], [31, 35], [31, 39], [24, 39.6]])],
    sizeM: 13,
    scale: 0.72,
  },
  airliner: {
    rings: [mirrored([[24, 2.5], [25.9, 3.8], [26.7, 6.7], [26.7, 18.1], [42.3, 26.9], [42.3, 30.6], [26.7, 25.9], [26.7, 35.7], [31.4, 39.3], [31.4, 42.5], [24, 40.3]])],
    sizeM: 46,
    scale: 1,
  },
  heavy: {
    rings: [mirrored([[24, 1], [26, 2.4], [27, 5.5], [27, 16], [46, 28.5], [46, 31.5], [27, 25.5], [27, 37.5], [34, 42], [34, 44.6], [24, 42.6]])],
    sizeM: 73,
    scale: 1.3,
  },
  fast: {
    rings: [mirrored([[24, 2], [25.4, 7], [26.2, 17], [40, 33], [40, 36.5], [27, 36.5], [29, 42.5], [24, 41.5]])],
    sizeM: 16,
    scale: 0.8,
  },
  helicopter: {
    rings: [
      mirrored([[24, 13], [26.6, 14.4], [27.6, 19], [27, 26.5], [25, 29.5], [25, 42], [24, 42]]),
      bar(23, 42.4, 29, 42.4, 2.4),
      bar(11, 9, 37, 35, 2.2),
      bar(37, 9, 11, 35, 2.2),
    ],
    sizeM: 16,
    scale: 0.8,
  },
  glider: {
    rings: [mirrored([[24, 8], [25.1, 9.2], [25.2, 16.3], [47, 17.2], [47, 19], [25.1, 19.6], [24.7, 37], [29.5, 37.4], [29.5, 39.4], [24, 39.6]])],
    sizeM: 19,
    scale: 0.85,
  },
  balloon: { rings: [circle(24, 24, 13)], sizeM: 30, scale: 0.7 },
  drone: {
    rings: [bar(13, 13, 35, 35, 2.6), bar(35, 13, 13, 35, 2.6), circle(13, 13, 5, 12), circle(35, 13, 5, 12), circle(13, 35, 5, 12), circle(35, 35, 5, 12)],
    sizeM: 3,
    scale: 0.55,
  },
  vehicle: { rings: [mirrored([[24, 12], [29, 12.6], [30, 15], [30, 35], [29, 36], [24, 36]])], sizeM: 12, scale: 0.5 },
};

export const CRAFTS = Object.keys(SHAPES) as Craft[];

/**
 * Silhouettes for common ICAO type designators, for aircraft that broadcast no emitter category (Mode S, MLAT and
 * many military aircraft). Types not listed here are drawn as airliners.
 */
const TYPE_CRAFT: Partial<Record<string, Craft>> = {
  ...Object.fromEntries(
    // Wide-bodies and other aircraft in the ICAO "heavy" wake category.
    ["A306", "A30B", "A310", "A332", "A333", "A337", "A338", "A339", "A342", "A343", "A345", "A346", "A359", "A35K", "A388", "A3ST", "A400", "B741", "B742", "B743", "B744", "B748", "B74S", "B762", "B763", "B764", "B772", "B773", "B77L", "B77W", "B778", "B779", "B788", "B789", "B78X", "C17", "C5M", "DC10", "MD11", "IL76", "IL96", "AN124", "AN225", "K35R", "KC10", "E3TF", "E6", "A332M"].map((t) => [t, "heavy" as const]),
  ),
  ...Object.fromEntries(
    ["C150", "C152", "C162", "C170", "C172", "C177", "C180", "C182", "C185", "C206", "C210", "P28A", "P28B", "P28R", "P32R", "PA18", "PA22", "PA24", "PA34", "PA44", "PA46", "SR20", "SR22", "DA20", "DA40", "DA42", "DA62", "BE33", "BE35", "BE36", "BE55", "BE58", "M20P", "M20T", "TB10", "TB20", "DR40", "AT3", "CRUZ", "RV7", "RV8", "RV10", "J3", "ULAC", "PC6T", "PC7", "PC9", "PC21", "TOBA"].map((t) => [t, "light" as const]),
  ),
  ...Object.fromEntries(
    ["F15", "F16", "F18", "F18S", "F22", "F35", "EUFI", "RFAL", "TOR", "M2000", "MIR2", "GRIF", "JAS39", "HAWK", "T38", "A10", "AJET", "M346", "L39", "SU27", "SU30", "MG29", "F5", "TEX2"].map((t) => [t, "fast" as const]),
  ),
  GLID: "glider",
  BALL: "balloon",
};

/** Which silhouette an aircraft takes: from its ADS-B emitter category, or without one from its type designator. */
export function craftOf(a: Pick<Aircraft, "category" | "typeCode">): Craft {
  if (isHelicopter(a)) return "helicopter";
  if (a.category === null) return (a.typeCode ? TYPE_CRAFT[a.typeCode] : undefined) ?? "airliner";
  switch (a.category) {
    case "A1":
    case "B4":
      return "light";
    case "A5":
      return "heavy";
    case "A6":
      return "fast";
    case "B1":
      return "glider";
    case "B2":
      return "balloon";
    case "B6":
      return "drone";
    case "C1":
    case "C2":
    case "C3":
      return "vehicle";
    default:
      return "airliner";
  }
}

export const craftIcon = (craft: Craft): string => `vantage-craft-${craft}`;

/** Every silhouette as a map icon, for `useMapIcons`. */
export const CRAFT_ICONS: readonly MapIconEntry[] = CRAFTS.map((craft) => ({ name: craftIcon(craft), load: () => Promise.resolve(craftSvg(craft)), size: 64 }));

/** The silhouette as white SVG markup, for the map to register as a tintable icon. */
export function craftSvg(craft: Craft): string {
  // One winding for every ring: under the nonzero fill rule, rings that overlap with opposite turns cancel out.
  const paths = SHAPES[craft].rings.map(clockwise).map((ring) => `M${ring.map(([x, y]) => `${x.toFixed(2)} ${y.toFixed(2)}`).join("L")}Z`);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><path fill="#fff" d="${paths.join("")}"/></svg>`;
}

/** Icon sizes by zoom, as [zoom, size] stops. */
export type SizeStops = readonly (readonly [number, number])[];

/** `icon-size` for a silhouette: the zoom's size times the craft's `scale` property. */
export function craftIconSize(stops: SizeStops): ExpressionSpecification {
  return ["interpolate", ["linear"], ["zoom"], ...stops.flatMap(([z, size]): [number, ExpressionSpecification] => [z, ["*", size, ["get", "scale"]]])];
}

/**
 * Rings ready for the ground. The map reads a ring that turns against the first one as a hole, so every ring turns
 * the same way: the counter-clockwise turn of a GeoJSON outer ring. A ring turns the same way on the grid and on the ground.
 */
const GROUND_RINGS = new Map(CRAFTS.map((craft) => [craft, SHAPES[craft].rings.map((ring) => [...clockwise(ring)].reverse())]));

const M_PER_DEG_LAT = 110_540;
const M_PER_DEG_LON = 111_320;

/**
 * The silhouette as polygons on the ground: `sizeM` metres across the 48 px grid, centred on `lon`/`lat` and turned
 * to `trackDeg` (clockwise from north).
 */
export function craftFootprint(craft: Craft, lon: number, lat: number, trackDeg: number, sizeM: number): GeoJSON.MultiPolygon {
  const m = sizeM / 48;
  const t = (trackDeg * Math.PI) / 180;
  const cos = Math.cos(t);
  const sin = Math.sin(t);
  const kx = 1 / (M_PER_DEG_LON * Math.cos((lat * Math.PI) / 180));
  const place = ([x, y]: readonly [number, number]): [number, number] => {
    const right = (x - 24) * m;
    const ahead = (24 - y) * m;
    return [lon + (right * cos + ahead * sin) * kx, lat + (ahead * cos - right * sin) / M_PER_DEG_LAT];
  };
  return {
    type: "MultiPolygon",
    coordinates: (GROUND_RINGS.get(craft) ?? []).map((ring) => {
      const points = ring.map(place);
      const first = points[0];
      return [first ? [...points, first] : points];
    }),
  };
}

/** Twice the signed area of a ring on the grid; positive when it runs clockwise on screen (y down). */
export function screenArea(ring: Ring): number {
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i] ?? [0, 0];
    const [x2, y2] = ring[(i + 1) % ring.length] ?? [0, 0];
    sum += x1 * y2 - x2 * y1;
  }
  return sum;
}

/** A square `sideM` metres across, centred on `lon`/`lat`: the foot of the mast that drops from an aircraft to the ground. */
export function mastFootprint(lon: number, lat: number, sideM: number): GeoJSON.Polygon {
  const dLat = sideM / 2 / M_PER_DEG_LAT;
  const dLon = sideM / 2 / (M_PER_DEG_LON * Math.cos((lat * Math.PI) / 180));
  return {
    type: "Polygon",
    coordinates: [
      [
        [lon - dLon, lat - dLat],
        [lon + dLon, lat - dLat],
        [lon + dLon, lat + dLat],
        [lon - dLon, lat + dLat],
        [lon - dLon, lat - dLat],
      ],
    ],
  };
}

/** Metres per CSS pixel at `zoom` and `lat` on a 512 px web-mercator map. */
export function metresPerPixel(zoom: number, lat: number): number {
  return (40_075_016.686 * Math.cos((lat * Math.PI) / 180)) / (512 * 2 ** zoom);
}
