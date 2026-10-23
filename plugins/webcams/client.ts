import { api, qs } from "../../app/core/api";
import type { LatLon } from "../../shared/geo";
import type { CamerasInView, CamerasNear, OrbitFrames, RandomCity, RemoteCameras } from "./types";

export const fetchCameras = (b: { west: number; south: number; east: number; north: number }, signal?: AbortSignal): Promise<CamerasInView> =>
  api<CamerasInView>(qs("/api/webcams/cameras", { minLat: b.south.toFixed(3), minLon: b.west.toFixed(3), maxLat: b.north.toFixed(3), maxLon: b.east.toFixed(3) }), { signal });

export const fetchNear = (at: LatLon, signal?: AbortSignal): Promise<CamerasNear> => api<CamerasNear>(qs("/api/webcams/near", { lat: at.lat.toFixed(5), lon: at.lon.toFixed(5), limit: 9 }), { signal });

export const fetchRandomCity = (signal?: AbortSignal): Promise<RandomCity> => api<RandomCity>("/api/webcams/random", { signal });

export const fetchRemote = (signal?: AbortSignal): Promise<RemoteCameras> => api<RemoteCameras>("/api/webcams/remote", { signal });

export const fetchOrbit = (signal?: AbortSignal): Promise<OrbitFrames> => api<OrbitFrames>("/api/webcams/orbit", { signal });

/** The same picture URL with a changing query, so the browser asks the operator for the new frame. */
export const freshUrl = (url: string, tick: number): string => `${url}${url.includes("?") ? "&" : "?"}t=${tick}`;
