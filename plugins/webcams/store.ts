import { create } from "zustand";
import type { LatLon } from "../../shared/geo";

/** The centre of the City map as the camera layers last saw it, so the wall can look where the map looks. */
interface MapCentre {
  centre: LatLon | null;
  set: (centre: LatLon) => void;
}

export const useMapCentre = create<MapCentre>((set) => ({
  centre: null,
  set: (centre) => set({ centre }),
}));
