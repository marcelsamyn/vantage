export { geographicBox } from "../../shared/geo";
export interface AprsBox { west: number; south: number; east: number; north: number }

export function insideBox(box: AprsBox, point: { lat: number | null; lon: number | null }): boolean {
  if (point.lat === null || point.lon === null || point.lat < box.south || point.lat > box.north) return false;
  return box.west <= box.east ? point.lon >= box.west && point.lon <= box.east : point.lon >= box.west || point.lon <= box.east;
}
