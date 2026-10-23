import { MAP_INK } from "../city/extension";

/** How Hamburg's signal codes read on screen. Colours follow the palette: red is alarm, amber is sodium, green is mint. */
export interface SignalLook {
  label: string;
  /** Map colour. */
  ink: string;
  /** CSS colour for the interface. */
  css: string;
  /** True for the two flashing states. */
  flashing: boolean;
}

const LOOKS: Record<number, SignalLook> = {
  0: { label: "Dark", ink: MAP_INK.ash, css: "var(--ash)", flashing: false },
  1: { label: "Red", ink: MAP_INK.alarm, css: "var(--alarm)", flashing: false },
  2: { label: "Amber", ink: MAP_INK.sodium, css: "var(--sodium)", flashing: false },
  3: { label: "Green", ink: MAP_INK.mint, css: "var(--mint)", flashing: false },
  4: { label: "Red and amber", ink: MAP_INK.sodium, css: "var(--sodium)", flashing: false },
  5: { label: "Flashing amber", ink: MAP_INK.sodium, css: "var(--sodium)", flashing: true },
  6: { label: "Flashing green", ink: MAP_INK.mint, css: "var(--mint)", flashing: true },
  9: { label: "Unknown", ink: MAP_INK.fog, css: "var(--fog)", flashing: false },
};

export function lookOf(code: number | boolean | undefined): SignalLook {
  return LOOKS[typeof code === "number" ? code : 9] ?? LOOKS[9]!;
}

/** MapLibre expression: the colour of a head from its feature-state `s`. */
export const STATE_COLOR: unknown[] = [
  "match",
  ["coalesce", ["feature-state", "s"], 9],
  0,
  MAP_INK.ash,
  1,
  MAP_INK.alarm,
  2,
  MAP_INK.sodium,
  3,
  MAP_INK.mint,
  4,
  MAP_INK.sodium,
  5,
  MAP_INK.sodium,
  6,
  MAP_INK.mint,
  MAP_INK.fog,
];

export const LANE_LABEL = {
  vehicle: "Cars and trucks",
  bus: "Buses",
  cycle: "Bicycles",
  pedestrian: "Pedestrians",
} as const;

/** What Hamburg's `laneType` strings say, in plain words. */
export function laneWords(laneType: string): string {
  const parts = laneType
    .split("/")
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => (p === "KFZ" ? "cars" : p === "Bus" ? "buses" : p === "Radfahrer" ? "bicycles" : p === "Fußgänger" ? "pedestrians" : p.toLowerCase()));
  if (parts.length === 0) return "road users";
  return parts.length === 1 ? (parts[0] ?? "road users") : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}
