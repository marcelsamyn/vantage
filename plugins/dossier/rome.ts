import type { ThingBox } from "../../app/core/things";

/** Rome and its ring road, the area the city's own datasets cover. */
const ROME = { west: 12.2, south: 41.6, east: 12.95, north: 42.2 };

/** Whether a view reaches Rome at all. A source of Rome records stays quiet, and silent, everywhere else. */
export const overlapsRome = (box: ThingBox): boolean => box.west <= ROME.east && box.east >= ROME.west && box.south <= ROME.north && box.north >= ROME.south;
