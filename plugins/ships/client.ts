import { api, qs } from "../../app/core/api";
import type { ShipDetails, ShipsNear } from "./types";
import { geographicBox } from "../../shared/geo";

export interface Box {
  west: number;
  south: number;
  east: number;
  north: number;
}

export function fetchShips(view: Box, signal?: AbortSignal): Promise<ShipsNear> {
  const box = geographicBox(view);
  return api<ShipsNear>(qs("/api/ships/near", { west: box.west.toFixed(2), south: box.south.toFixed(2), east: box.east.toFixed(2), north: box.north.toFixed(2) }), { signal });
}

export const fetchShip = (mmsi: number, signal?: AbortSignal): Promise<ShipDetails> => api<ShipDetails>(qs("/api/ships/vessel", { mmsi }), { signal });
