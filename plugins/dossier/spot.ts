import type { Entity } from "../../app/core/plugin";
import { profile } from "../../app/core/profile";

interface Spot {
  id: string;
  name: string;
  kind: string;
  context: string;
  lat: number;
  lon: number;
}

/** The place profile for a point a layer knows by name: a tree, a fountain. The profile adds every register's facts for that spot. */
export const spotEntity = (spot: Spot): Extract<Entity, { kind: "place" }> => ({
  kind: "place",
  id: spot.id,
  data: { lat: spot.lat, lon: spot.lon, name: spot.name, context: spot.context, area: "", kind: spot.kind, countryCode: null },
});

export function openSpot(spot: Spot): void {
  profile.open(spotEntity(spot));
}
