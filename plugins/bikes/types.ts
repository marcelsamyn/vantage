import type { FormFactor } from "./gbfs";

/** Payloads served by /api/bikes: bike-share stations (CityBikes) and free-floating scooters and bikes (operators' GBFS feeds). */

export interface BikeNetwork {
  id: string;
  name: string;
  city: string;
  company: string | null;
}

export interface BikeStation {
  id: string;
  network: string;
  name: string;
  lat: number;
  lon: number;
  bikes: number;
  ebikes: number | null;
  docks: number | null;
  renting: boolean;
  updated: string;
}

export interface BikesNear {
  networks: BikeNetwork[];
  stations: BikeStation[];
}

/** A scooter, moped or bicycle that can be unlocked where it stands. */
export interface FreeVehicle {
  /** "<system id>~<vehicle id>". */
  id: string;
  systemId: string;
  /** The system's own name from its `system_information`, or the catalogue's name when the feed is silent. */
  systemName: string;
  /** The operator's own name from the feed's `system_information`. */
  operator: string | null;
  lat: number;
  lon: number;
  form: FormFactor;
  formName: string;
  /** "electric", "electric_assist", "human" or "combustion" when the operator says. */
  propulsion: string | null;
  typeName: string | null;
  /** The pricing plan this vehicle belongs to, when the feed says. */
  planId: string | null;
  /** Distance it can still go, in metres, as the operator reports it. */
  rangeM: number | null;
  /** Range on a full charge for this type. */
  maxRangeKm: number | null;
  /** Battery or fuel as a share from 0 to 1, as the operator reports it. */
  charge: number | null;
  /** Where the operator rents it out, checked by the server; null when the feed carries no link. */
  rentalUrl: string | null;
}

export interface FreeVehicles {
  fetchedAt: number;
  systems: { id: string; name: string; count: number; ok: boolean; error?: string }[];
  vehicles: FreeVehicle[];
}

declare module "../../app/core/plugin" {
  interface EntityKinds {
    bikestation: BikeStation & { networkName: string };
  }
}
